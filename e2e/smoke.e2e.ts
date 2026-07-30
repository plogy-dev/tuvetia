/**
 * Smoke E2E contra el despliegue REAL. Es el entregable de "smoke testing end to end" del
 * Milestone 2 (§2.4 de la auditoría), y la capa que faltaba: los 222 unitarios son puros y no
 * tocan la app corriendo, así que ninguno de los fallos que aparecieron en producción esta semana
 * —CRON_SECRET ausente, subida de logos rota, agente sin key— habría sido detectado por ellos.
 *
 * Todo lo de acá es de SOLO LECTURA o peticiones que deben ser RECHAZADAS. No escribe nada, no
 * necesita sesión y es seguro correrlo contra producción tantas veces como se quiera.
 *
 * Distinción que vale la pena entender antes de leer las aserciones:
 *   401 = la ruta existe y está protegida   → correcto
 *   503 = la ruta existe pero NO está configurada → función apagada en silencio
 * Confundir esos dos es exactamente el error que dejó la retención de audio caída sin que nadie se
 * enterara. Por eso varias pruebas afirman "401 y NO 503".
 *
 * Uso:
 *   npm run test:e2e                                  (contra producción)
 *   SMOKE_BASE_URL=http://localhost:3000 npm run test:e2e
 *   SMOKE_CRON_SECRET=... npm run test:e2e            (habilita el chequeo de configuración)
 */
import { describe, expect, it } from "vitest"

const BASE = (process.env.SMOKE_BASE_URL ?? "https://tuvetia.vercel.app").replace(/\/$/, "")
const ATHOS = (
  process.env.SMOKE_ATHOS_URL ?? "https://athos-service-production.up.railway.app"
).replace(/\/$/, "")
const CRON_SECRET = process.env.SMOKE_CRON_SECRET?.trim()

/** GET sin seguir redirects: el redirect ES lo que se quiere verificar en las rutas protegidas. */
function get(path: string, init?: RequestInit) {
  return fetch(`${BASE}${path}`, { redirect: "manual", ...init })
}

function post(path: string, body: unknown = {}) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("front · las páginas públicas responden", () => {
  const PUBLICAS = [
    ["/", "landing"],
    ["/login", "login"],
    ["/signup", "registro"],
    ["/producto", "subpágina de producto"],
    ["/seguridad", "subpágina de seguridad"],
    ["/demo", "subpágina de demo"],
    ["/legal/terminos", "términos"],
    ["/legal/privacidad", "privacidad"],
  ] as const

  for (const [path, nombre] of PUBLICAS) {
    it(`${path} (${nombre}) responde 200`, async () => {
      const res = await get(path)
      expect(res.status, `${path} debería ser 200`).toBe(200)
    })
  }

  it("la raíz sirve la landing de verdad, no una página de error", async () => {
    // Un 200 no alcanza: Next devuelve 200 en su propia error page. Se verifica contenido real.
    const html = await (await get("/")).text()
    // Fragmento corto a propósito: el titular viene partido en varios elementos, así que una frase
    // larga falla por el markup y no por el contenido.
    expect(html).toContain("primer agente de IA")
    expect(html).not.toContain("Application error")
  })

  it("/login muestra el formulario con la marca correcta", async () => {
    const html = await (await get("/login")).text()
    expect(html).toContain("Bienvenido a Tuvetia")
    // El rebrand: si vuelve "TuvetIA" en la marca visible, alguien revirtió el cambio.
    expect(html).not.toContain("Bienvenido a TuvetIA")
  })
})

describe("front · las rutas privadas están cerradas", () => {
  it("/dashboard sin sesión redirige a /login", async () => {
    const res = await get("/dashboard")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("/dashboard/settings sin sesión también redirige", async () => {
    const res = await get("/dashboard/settings")
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toContain("/login")
  })

  it("ninguna ruta privada devuelve 200 con contenido a un anónimo", async () => {
    for (const path of ["/dashboard", "/dashboard/patients", "/dashboard/comunicaciones"]) {
      const res = await get(path)
      expect(res.status, `${path} no debe servir contenido sin sesión`).not.toBe(200)
    }
  })
})

describe("crons · protegidos Y configurados", () => {
  // 401 = hay secreto y rechaza. 503 = falta CRON_SECRET → el cron NO corre.
  // Este es el chequeo que faltaba: la purga de audio estuvo caída sin que nadie lo notara.
  const CRONS = ["/api/cron/purge-audio", "/api/cron/cartera"] as const

  for (const path of CRONS) {
    it(`${path} responde 401 (y NO 503, que significaría CRON_SECRET ausente)`, async () => {
      const res = await get(path)
      expect(res.status, `${path}: 503 = falta CRON_SECRET y el cron no corre`).not.toBe(503)
      expect(res.status).toBe(401)
    })
  }
})

describe("APIs de sesión · rechazan sin autenticar", () => {
  it("el agente de Athos no atiende sin sesión", async () => {
    expect((await post("/api/athos/agent", { messages: [] })).status).toBe(401)
  })

  it("no se puede mandar WhatsApp sin sesión", async () => {
    expect((await post("/api/whatsapp/send", { to: "3001234567", body: "x" })).status).toBe(401)
  })

  it("no se puede ejecutar una acción propuesta sin sesión", async () => {
    const id = "00000000-0000-0000-0000-000000000000"
    expect((await post(`/api/athos/actions/${id}/execute`)).status).toBe(401)
  })

  it("no se puede rechazar una acción sin sesión", async () => {
    const id = "00000000-0000-0000-0000-000000000000"
    expect((await post(`/api/athos/actions/${id}/reject`)).status).toBe(401)
  })

  it("no se puede cambiar el modo del agente sin sesión", async () => {
    expect((await post("/api/whatsapp/agent-mode", { mode: "auto" })).status).toBe(401)
  })
})

describe("webhook de WhatsApp · autenticado, no abierto", () => {
  it("rechaza un POST sin firma ni secreto", async () => {
    const res = await post("/api/whatsapp/webhook", { entry: [] })
    // 503 significaría que no hay NINGÚN secreto configurado: el webhook no podría recibir nada.
    expect(res.status, "503 = sin secretos configurados, el webhook está muerto").not.toBe(503)
    expect(res.status).toBe(401)
  })

  it("el challenge de Meta rechaza un verify_token incorrecto", async () => {
    const res = await get("/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=123")
    expect(res.status).toBe(403)
  })

  // Invariante de seguridad: nunca abierto. Se separa del chequeo de configuración porque son dos
  // cosas distintas — que esté cerrado es obligatorio siempre; que esté configurado depende de si la
  // clínica usa Evolution. Mezclarlos dejaba la suite en rojo permanente y eso se ignora.
  it("el webhook de Evolution nunca acepta un token inválido", async () => {
    const res = await post("/api/whatsapp/evolution/webhook/token-invalido", { event: "x", instance: "y" })
    expect(res.status, "un token inválido jamás debe ser aceptado").not.toBe(200)
    expect([401, 503]).toContain(res.status)
  })
})

describe("backend Athos (Railway) · vivo y cerrado", () => {
  it("/health responde ok", async () => {
    const res = await fetch(`${ATHOS}/health`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: "ok" })
  })

  it("el chat clínico exige JWT", async () => {
    const res = await fetch(`${ATHOS}/athos/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: "x", patient_id: null, clinic_id: "x" }),
    })
    expect(res.status).toBe(401)
  })

  it("el retrieval de evidencia exige JWT", async () => {
    const res = await fetch(`${ATHOS}/athos/retrieve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clinic_id: "x", question: "x" }),
    })
    expect(res.status).toBe(401)
  })

  it("el endpoint de ingesta ya no existe (era un stub público)", async () => {
    // Se eliminó como hallazgo de seguridad el 28-jul. Si vuelve, este test avisa.
    const res = await fetch(`${ATHOS}/ingest`, { method: "POST" })
    expect(res.status, "/ingest no debería existir").toBe(404)
  })
})

describe("configuración del despliegue", () => {
  it("/api/health nunca responde sin credencial", async () => {
    const res = await get("/api/health")
    // 404 = todavía no desplegado (el endpoint entra con este PR). 200 sin credencial sería el
    // problema real: expondría qué integraciones tiene el despliegue.
    expect(res.status, "/api/health no debe responder 200 sin credencial").not.toBe(200)
  })

  // Este es el chequeo que habría atrapado un ANTHROPIC_API_KEY ausente: sin él, el agente de 17
  // tools no responde y no hay ningún síntoma visible desde afuera.
  it.skipIf(!CRON_SECRET)("todas las variables críticas están cableadas", async () => {
    const res = await get("/api/health", {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
    })
    expect(res.status, "el secreto no coincide con el del despliegue").toBe(200)
    const body = (await res.json()) as { ok: boolean; missing: string[] }
    expect(body.missing, `configuración incompleta: ${body.missing?.join(", ")}`).toEqual([])
    expect(body.ok).toBe(true)
  })
})
