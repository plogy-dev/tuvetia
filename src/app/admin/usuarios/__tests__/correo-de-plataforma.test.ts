// El correo que Tuvetia le manda a SUS usuarios desde /admin/usuarios: el individual y el masivo.
//
// POR QUÉ ESTE ARCHIVO. Este envío salía en texto plano, y no porque alguien lo hubiera decidido:
// el tipo del transporte pedía `text` y dejaba `html` opcional, así que el camino corto era el que
// no maquetaba. Dado vuelta el tipo, que haya HTML lo garantiza el compilador. Lo que el compilador
// NO mira es lo que se fija acá: que el asunto siga siendo el que la gente reconoce en la bandeja,
// que el cuerpo que un admin escribió en un textarea no pueda desarmar la maqueta, y que el
// `text/plain` no se vuelva a escribir a mano en paralelo al HTML.

import { beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
const sendPlatformEmail = vi.fn()

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}))

// La traza de cada envío no es lo que se prueba acá, pero la acción la escribe siempre: sin este
// doble, el primer `insert` revienta y se lleva puesto el envío que sí importa.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}))

vi.mock("@/lib/email/platform-sender", () => ({
  // Envuelto en una arrow a propósito: la factory de `vi.mock` se hoistea, y nombrar el spy directo
  // acá lo lee antes de que exista (TDZ). Dentro de la arrow se resuelve recién al llamarlo.
  sendPlatformEmail: (...args: unknown[]) =>
    (sendPlatformEmail as (...a: unknown[]) => unknown)(...args),
  platformEmailConfigurado: () => true,
}))

import { enviarCorreoMasivo, enviarCorreoPlataforma } from "@/app/admin/usuarios/actions"
import { textoDelCorreo } from "@/lib/email/maqueta"

const ADMIN = { id: "11111111-1111-4111-8111-111111111111", email: "admin@tuvetia.com" }

type Enviado = { to: string; subject: string; html: string; text?: string | null }

/** Lo que recibió el transporte en el envío número `n`. */
const enviado = (n = 0) => sendPlatformEmail.mock.calls[n][0] as Enviado

/** El preheader tal como quedó en el HTML: el renglón que la bandeja muestra junto al asunto. */
const preheaderDe = (html: string) => html.match(/data-tv-preheader="1"[^>]*>([^<]*)</)?.[1] ?? ""

/** Un aviso operativo cualquiera, con la forma que dejan las plantillas: saludo, cuerpo, firma. */
const AVISO = {
  to: "vet@clinica.com",
  subject: "Mantenimiento programado el 3 de septiembre",
  text:
    "Hola,\n\n" +
    "El 3 de septiembre, entre las 22:00 y las 23:30, vamos a hacer un mantenimiento.\n\n" +
    "El equipo de Tuvetia",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", ADMIN.email)
  getUser.mockResolvedValue({ data: { user: ADMIN } })
  sendPlatformEmail.mockResolvedValue({ ok: true, id: "re_1" })
})

describe("el aviso de plataforma llega maquetado", () => {
  it("sale en HTML con la marca, no como un bloque de texto suelto", async () => {
    await enviarCorreoPlataforma(AVISO)
    expect(enviado().html).toContain("<table")
    expect(enviado().html).toContain("Tuvetia")
  })

  it("el texto plano NO se escribe a mano: lo deriva el transporte del mismo HTML", async () => {
    // Dos redacciones en paralelo terminan diciendo cosas distintas, y la que se lee en modo texto
    // es justo la que nadie mira cuando cambia la otra.
    await enviarCorreoPlataforma(AVISO)
    expect(enviado().text).toBeUndefined()
  })

  it("el asunto sale tal cual se escribió: es lo que se reconoce en la bandeja", async () => {
    await enviarCorreoPlataforma(AVISO)
    expect(enviado().subject).toBe(AVISO.subject)
  })

  it("lo que redactó el admin llega entero, párrafo por párrafo", async () => {
    await enviarCorreoPlataforma(AVISO)
    const texto = textoDelCorreo(enviado().html)
    expect(texto).toContain("El 3 de septiembre, entre las 22:00 y las 23:30")
    expect(texto).toContain("El equipo de Tuvetia")
  })

  it("el renglón de la bandeja dice qué pasó, no «Hola,»", async () => {
    // Las cuatro plantillas arrancan con el saludo. Tomar el primer párrafo a secas pondría "Hola,"
    // al lado del asunto y desperdiciaría el único renglón de contexto que la bandeja regala.
    await enviarCorreoPlataforma(AVISO)
    const preheader = preheaderDe(enviado().html)
    expect(preheader).not.toMatch(/^Hola,/)
    expect(preheader).toContain("El 3 de septiembre")
  })

  it("un cuerpo con etiquetas adentro no desarma la maqueta", async () => {
    // El cuerpo lo escribe una persona en un textarea: es el contenido menos confiable del panel, y
    // un `&` suelto o un `<b>` copiado de otro lado no pueden salirse del párrafo.
    await enviarCorreoPlataforma({
      ...AVISO,
      text: "Hola,\n\nCambió el <b>informe</b> & el listado.",
    })
    const { html } = enviado()
    expect(html).not.toContain("<b>informe</b>")
    expect(html).toContain("&lt;b&gt;informe&lt;/b&gt;")
    // Y del otro lado se sigue leyendo lo que se escribió, sin entidades a la vista.
    expect(textoDelCorreo(html)).toContain("Cambió el <b>informe</b> & el listado.")
  })
})

describe("el masivo", () => {
  it("cada destinatario recibe el mismo aviso maquetado", async () => {
    const res = await enviarCorreoMasivo({
      destinatarios: ["uno@clinica.com"],
      subject: AVISO.subject,
      text: AVISO.text,
    })

    expect(res).toMatchObject({ ok: true, enviados: 1 })
    expect(enviado().html).toContain("<table")
    expect(enviado().text).toBeUndefined()
    expect(textoDelCorreo(enviado().html)).toContain("vamos a hacer un mantenimiento")
  })
})
