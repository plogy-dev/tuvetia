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

vi.mock("@/lib/athos-agent/tools", () => ({ buildAthosTools: () => ({}) }))
vi.mock("@/lib/athos-agent/model", () => ({
  agentModel: () => "modelo-falso",
  agentModelId: () => "modelo-falso",
}))
vi.mock("@/lib/athos-agent/system-prompt", () => ({ ATHOS_AGENT_SYSTEM_PROMPT: "SYS" }))
vi.mock("@/lib/athos-agent/rate-limit", () => ({ rateLimit: () => ({ allowed: true }) }))

import { POST } from "@/app/api/athos/suggest-reply/route"

const pedir = (phone = "+57 300 1234567") =>
  POST(new Request("https://x/api/athos/suggest-reply", { method: "POST", body: JSON.stringify({ phone }) }))

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  perfil.mockResolvedValue({ data: { clinic_id: "c1" } })
})

describe("POST /api/athos/suggest-reply", () => {
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

  it("el modelo corre pero no propone: 502 con una salida accionable", async () => {
    contarMensajes.mockResolvedValue({ count: 3 })
    generateTextMock.mockResolvedValue({ steps: [{ toolCalls: [], toolResults: [] }] })

    const res = await pedir()
    const body = (await res.json()) as { error: string }

    expect(res.status).toBe(502)
    expect(body.error).toMatch(/no propuso una respuesta/i)
    expect(body.error).toMatch(/escribe tú el borrador/i)
  })
})
