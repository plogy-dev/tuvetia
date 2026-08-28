// El botón "Sugerir" de la bandeja de WhatsApp.
//
// Existe por lo que pasó el 2026-07-31 al conectar el primer número: con la conversación recién
// abierta y todavía sin mensajes, el botón devolvía "Athos no pudo proponer una respuesta", que se
// lee como una falla del sistema. No lo era — el agente hacía lo correcto al no proponer nada:
// `docs/EVOLUTION.md` documenta la regla inbound-first ("el agente solo responde entrantes; no hay
// envíos masivos ni en frío") como una de las protecciones anti-baneo del número.
//
// Estas pruebas fijan las dos mitades: que una conversación vacía se corta ANTES de gastar una
// llamada al modelo, y que con mensajes sí se llega a proponer.
import { beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
const perfil = vi.fn()
const contarMensajes = vi.fn()
const generateTextMock = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser,
      getSession: async () => ({ data: { session: { access_token: "tok" } } }),
    },
    from: (tabla: string) => {
      if (tabla === "whatsapp_messages") {
        return { select: () => ({ or: contarMensajes }) }
      }
      return { select: () => ({ eq: () => ({ maybeSingle: perfil }) }) }
    },
  }),
}))

vi.mock("ai", () => ({
  generateText: (...args: unknown[]) => generateTextMock(...args),
  stepCountIs: (n: number) => n,
  tool: (t: unknown) => t,
}))

// Con claves REALES: el test del subconjunto de tools filtra sobre esto — un {} vacío haría pasar
// la aserción "no viaja update_appointment" sin probar nada.
vi.mock("@/lib/athos-agent/tools", () => ({
  buildAthosTools: () => ({
    search_whatsapp_conversation: {},
    get_owner_by_phone: {},
    list_available_slots: {},
    send_whatsapp_message: {},
    create_appointment: {},
    update_appointment: {},
    update_patient_record: {},
  }),
}))
vi.mock("@/lib/athos-agent/model", () => ({
  agentModel: () => ({ model: "modelo-falso", modelId: "modelo-falso" }),
}))
vi.mock("@/lib/athos-agent/system-prompt", () => ({ ATHOS_AGENT_SYSTEM_PROMPT: "SYS" }))
vi.mock("@/lib/athos-agent/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }))

import { POST } from "@/app/api/athos/suggest-reply/route"

const pedir = (phone = "+57 300 1234567") =>
  POST(new Request("https://x/api/athos/suggest-reply", { method: "POST", body: JSON.stringify({ phone }) }))

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  // `clinic: { plan: "pro" }` es el embed que `clinicaDeLaSesion` pide en el mismo select. Sin él,
  // el plan cae a `free` —que es lo correcto: ante la duda, negar— y la ruta cortaría con 402 antes
  // de llegar a lo que estos tests miden.
  perfil.mockResolvedValue({ data: { clinic_id: "c1", clinic: { plan: "pro" } } })
})

describe("POST /api/athos/suggest-reply", () => {
  // EL GATE DEL PLAN, Y LO QUE MIDE ES QUE NO SE GASTE.
  //
  // Una clínica free tiene que cortar ANTES del modelo. Si este test se cayera —porque alguien
  // mueve el gate más abajo, o lo saca— el síntoma en producción sería una factura de IA de
  // clínicas que no pagan, y nadie lo notaría hasta cerrar el mes.
  it("plan free: 402 sin llamar al modelo, y dice que es de Pro", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: "c1", clinic: { plan: "free" } } })
    contarMensajes.mockResolvedValue({ count: 3 })

    const res = await pedir()
    const body = (await res.json()) as { error: string; requierePlan?: string }

    expect(res.status).toBe(402) // 402 y no 403: le falta plan, no permiso
    expect(body.requierePlan).toBe("pro") // lo que le permite a la bandeja abrir la ventana
    expect(body.error).toMatch(/pro/i)
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it("conversación sin mensajes: explica por qué y NO llama al modelo", async () => {
    contarMensajes.mockResolvedValue({ count: 0 })

    const res = await pedir()
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(422) // no es 502: no falló nada, no hay nada que responder
    expect(body.error).toMatch(/no tiene mensajes/i)
    expect(body.error).toMatch(/escríbele tú/i) // dice qué hacer, no solo que no se pudo
    // Lo que more importa: no se gastó una llamada al LLM para descubrir lo obvio.
    expect(generateTextMock).not.toHaveBeenCalled()
  })

  it("con mensajes: llama al modelo y devuelve el borrador con su action_id", async () => {
    contarMensajes.mockResolvedValue({ count: 3 })
    generateTextMock.mockResolvedValue({
      steps: [
        {
          toolCalls: [{ toolName: "send_whatsapp_message", input: { body: "Claro, te esperamos el martes." } }],
          toolResults: [{ toolName: "send_whatsapp_message", output: { action_id: "a-1" } }],
        },
      ],
    })

    const res = await pedir()
    const body = (await res.json()) as { draft: string; action_id: string }

    expect(res.status).toBe(200)
    expect(body.draft).toBe("Claro, te esperamos el martes.")
    expect(body.action_id).toBe("a-1")
    expect(generateTextMock).toHaveBeenCalledOnce()
  })

  // EL CASO DEL 28-AGO: el titular pide cambiar la hora de la cita, el modelo se enreda con una
  // tool y generateText LANZA — el vet se quedaba con "no se pudo generar la sugerencia" y el
  // mensaje sin responder. El reintento mínimo (leer + proponer, sin investigación) lo rescata.
  it("si el primer intento lanza, reintenta y devuelve el borrador del segundo", async () => {
    contarMensajes.mockResolvedValue({ count: 3 })
    generateTextMock
      .mockRejectedValueOnce(new Error("Invalid tool input"))
      .mockResolvedValueOnce({
        steps: [
          {
            toolCalls: [{ toolName: "send_whatsapp_message", input: { body: "Claro, te la cambiamos a las 4:00 pm." } }],
            toolResults: [{ toolName: "send_whatsapp_message", output: { action_id: "a-2" } }],
          },
        ],
      })

    const res = await pedir()
    const body = (await res.json()) as { draft: string; action_id: string }

    expect(res.status).toBe(200)
    expect(body.draft).toBe("Claro, te la cambiamos a las 4:00 pm.")
    expect(body.action_id).toBe("a-2")
    expect(generateTextMock).toHaveBeenCalledTimes(2)
  })

  it("desde Sugerir no viajan tools de escritura de agenda: el modelo no puede irse por esa rama", async () => {
    contarMensajes.mockResolvedValue({ count: 3 })
    generateTextMock.mockResolvedValue({
      steps: [
        {
          toolCalls: [{ toolName: "send_whatsapp_message", input: { body: "ok" } }],
          toolResults: [{ toolName: "send_whatsapp_message", output: { action_id: "a-1" } }],
        },
      ],
    })
    await pedir()
    const { tools, system } = generateTextMock.mock.calls[0][0] as {
      tools: Record<string, unknown>
      system: string
    }
    expect(Object.keys(tools)).not.toContain("update_appointment")
    expect(Object.keys(tools)).not.toContain("create_appointment")
    // Y el prompt le dice qué hacer con un cambio de cita: responder que se gestiona, no gestionarlo.
    expect(system).toMatch(/cambiar o cancelar una cita/i)
    expect(system).toMatch(/NO intentes cambiar la cita/i)
  })

  it("el modelo corre pero no propone: 502 con una salida accionable", async () => {
    contarMensajes.mockResolvedValue({ count: 3 })
    generateTextMock.mockResolvedValue({ steps: [{ toolCalls: [], toolResults: [] }] })

    const res = await pedir()
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(502)
    expect(body.error).toMatch(/no propuso una respuesta/i)
    expect(body.error).toMatch(/escribe tú el borrador/i)
  })

  // LO QUE ESTE BLOQUE HEREDA.
  //
  // Hasta hoy, el único sitio que fijaba "el borrador de WhatsApp no diagnostica ni inventa datos
  // de la clínica" era un test del camino VIEJO (`athos-service/tests/test_whatsapp_reply.py`),
  // sobre un endpoint que ya no llamaba nadie. Al borrar ese endpoint la regla se quedaba sin
  // nadie que la sostuviera, y es de las que importan: lo que sale por acá lo lee el TITULAR, no
  // el vet. Así que se fija sobre el prompt que de verdad se manda.
  describe("los guardrails del borrador", () => {
    const conMensajes = () => {
      contarMensajes.mockResolvedValue({ count: 3 })
      generateTextMock.mockResolvedValue({
        steps: [
          {
            toolCalls: [{ toolName: "send_whatsapp_message", input: { body: "ok" } }],
            toolResults: [{ toolName: "send_whatsapp_message", output: { action_id: "a-1" } }],
          },
        ],
      })
    }

    it("el prompt prohíbe lo clínico y los datos inventados, y PROPONE en vez de enviar", async () => {
      conMensajes()
      await pedir()

      const { system } = generateTextMock.mock.calls[0][0] as { system: string }
      expect(system).toMatch(/nunca diagnósticos ni dosis/i)
      expect(system).toMatch(/nunca inventes horarios o precios/i)
      // Y que el verbo sea PROPONER: el envío es la aprobación humana de la acción, no un efecto
      // del modelo. Si esto dijera "envía", Athos escribiría solo.
      expect(system).toMatch(/PROPONE[\s\S]*send_whatsapp_message/)
    })

    it("y la regla de plataforma sigue escrita, no sólo la de esta pantalla", async () => {
      // El prompt base está mockeado como "SYS" arriba —a estos tests no les importa su contenido—
      // así que se pide el de verdad. Es la regla 4 del agente: vale en TODAS las superficies, y
      // esta pantalla es sólo una de ellas.
      const real = await vi.importActual<typeof import("@/lib/athos-agent/system-prompt")>(
        "@/lib/athos-agent/system-prompt",
      )
      expect(real.ATHOS_AGENT_SYSTEM_PROMPT).toMatch(/nada clínico va por whatsapp al dueño/i)
      expect(real.ATHOS_AGENT_SYSTEM_PROMPT).toMatch(/ni dosis, ni fuentes, ni horarios, ni precios/i)
    })
  })
})
