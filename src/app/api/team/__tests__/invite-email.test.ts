// La invitación de equipo por correo: qué sale, a quién, y qué pasa cuando no sale.
//
// Este envío iba por el SMTP de Supabase Auth (`inviteUserByEmail`) y ahí vivían dos de los cuatro
// bugs que el cliente reportó como "el enlace no hace nada":
//   1) `redirectTo` apuntaba a /invitar/<token>, que NO canjea el `?code=` de PKCE -> el invitado
//      aterrizaba sin sesión.
//   2) el origen salía de `new URL(req.url).origin`, que en un deployment de preview es un dominio
//      efímero fuera de la allow-list de Supabase -> el enlace moría antes de llegar.
//
// Ahora sale por Resend (ver CORREOS.md) con el enlace directo a /invitar/<token>, que es una página
// pública y sabe recibir a alguien sin sesión. El (1) deja de existir por construcción; el (2) sigue
// siendo posible —el origen se puede volver a leer de la request sin querer— así que se fija acá.
import { beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
const perfil = vi.fn()
const invitacion = vi.fn()
const sendTransactionalEmail = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: perfil }) }) }),
  }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ maybeSingle: invitacion }) }) }),
    }),
  }),
}))
vi.mock("@/lib/base-url", () => ({ getAppBaseUrl: () => "https://app.tuvetia.com" }))
vi.mock("@/lib/email/transactional", () => ({
  loadClinicSender: async () => ({ displayName: "Clínica Norte", replyTo: ["admin@clinica.com"] }),
  // Envuelto en una arrow a propósito: la factory de vi.mock se hoistea, y nombrar el spy directo
  // acá lo lee antes de que exista (TDZ). Dentro de la arrow se resuelve recién al llamarlo.
  sendTransactionalEmail: (...args: unknown[]) =>
    (sendTransactionalEmail as (...a: unknown[]) => unknown)(...args),
}))

import { POST } from "@/app/api/team/invite-email/route"
import { textoDelCorreo } from "@/lib/email/maqueta"

/**
 * El correo tal como lo lee quien está en modo texto plano.
 *
 * Se afirma sobre ESTO y no sobre el HTML crudo a propósito. Desde que el correo sale maquetado, la
 * alternativa `text/plain` ya no se escribe: la deriva el transporte de este mismo HTML. Mirar el
 * fuente diría que el enlace está en un `href` —y un `href` no sobrevive a la derivación—; mirar el
 * texto derivado dice que el invitado puede efectivamente copiarlo.
 */
const enTexto = () => textoDelCorreo(sendTransactionalEmail.mock.calls[0][1].html)

const pedir = (body: unknown) =>
  POST(
    new Request("https://efimero-abc123.vercel.app/api/team/invite-email", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  )

/** Dentro de 7 días, como lo deja `create_invitation`. */
const vigente = new Date(Date.now() + 7 * 24 * 3600_000).toISOString()

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: "admin-1" } } })
  perfil.mockResolvedValue({ data: { clinic_id: "c-1", role: "admin", full_name: "Ana Ruiz" } })
  invitacion.mockResolvedValue({
    data: { email: "nuevo@ejemplo.com", clinic_id: "c-1", expires_at: vigente },
  })
  sendTransactionalEmail.mockResolvedValue({ ok: true, id: "re_1" })
})

describe("el correo que recibe el invitado", () => {
  it("va al email con el que se creó la invitación", async () => {
    const res = await pedir({ token: "tok-9" })
    expect(await res.json()).toEqual({ sent: true, to: "nuevo@ejemplo.com" })
    const [clinicId, input] = sendTransactionalEmail.mock.calls[0]
    expect(clinicId).toBe("c-1")
    expect(input.to).toBe("nuevo@ejemplo.com")
  })

  it("lleva el enlace de aceptación con el token", async () => {
    await pedir({ token: "tok-9" })
    const { html } = sendTransactionalEmail.mock.calls[0][1]
    expect(html).toContain('href="https://app.tuvetia.com/invitar/tok-9"')
  })

  it("el enlace se puede COPIAR, no sólo apretar", async () => {
    // Un `href` desaparece al derivar el texto plano, y hay clientes que además se comen el botón.
    // Sin la dirección escrita, el correo queda diciendo "aceptá acá" sin ningún "acá" — y el
    // enlace es el camino garantizado de este flujo, no un adorno.
    await pedir({ token: "tok-9" })
    expect(enTexto()).toContain("https://app.tuvetia.com/invitar/tok-9")
  })

  it("usa el dominio estable, no el efímero del deployment", async () => {
    // La petición llega a efimero-abc123.vercel.app y ese origen NO debe aparecer en el enlace:
    // un dominio de preview desaparece y se lleva la invitación con él.
    await pedir({ token: "tok-9" })
    const { html } = sendTransactionalEmail.mock.calls[0][1]
    expect(html).not.toContain("efimero-abc123")
  })

  it("dice quién invita y a qué clínica", async () => {
    await pedir({ token: "tok-9" })
    const { subject } = sendTransactionalEmail.mock.calls[0][1]
    expect(subject).toContain("Clínica Norte")
    expect(enTexto()).toContain("Ana Ruiz")
    expect(enTexto()).toContain("Clínica Norte")
  })

  it("sin nombre del que invita, el correo sale igual", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: "c-1", role: "admin", full_name: null } })
    await pedir({ token: "tok-9" })
    expect(enTexto()).toContain("Te invitaron a unirte al equipo de Clínica Norte")
  })

  it("sale maquetado, y el texto plano NO se escribe a mano", async () => {
    // Las dos mitades de la misma decisión. Si alguien volviera a pasar `text`, el correo tendría
    // dos redacciones que mantener sincronizadas — y la que se lee en modo texto es justo la que
    // nadie mira cuando cambia la otra.
    await pedir({ token: "tok-9" })
    const input = sendTransactionalEmail.mock.calls[0][1]
    expect(input.html).toContain("<table")
    expect(input.text).toBeUndefined()
  })
})

describe("autorización", () => {
  it("sin sesión no manda nada", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await pedir({ token: "tok-9" })).status).toBe(401)
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("un vet no puede invitar: solo administradores", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: "c-1", role: "vet", full_name: "Beto" } })
    expect((await pedir({ token: "tok-9" })).status).toBe(403)
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("no se puede reenviar la invitación de OTRA clínica", async () => {
    invitacion.mockResolvedValue({
      data: { email: "x@y.com", clinic_id: "otra-clinica", expires_at: vigente },
    })
    expect((await pedir({ token: "tok-9" })).status).toBe(404)
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })

  it("sin token responde 400", async () => {
    expect((await pedir({})).status).toBe(400)
  })
})

describe("degradación", () => {
  it("si el correo no sale, se dice por qué: el enlace es el camino garantizado", async () => {
    sendTransactionalEmail.mockResolvedValue({
      ok: false,
      id: null,
      error: "El dominio del remitente no está verificado en Resend.",
      transient: false,
    })
    const res = await pedir({ token: "tok-9" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      sent: false,
      reason: "El dominio del remitente no está verificado en Resend.",
    })
  })

  it("no manda un enlace ya vencido", async () => {
    // Enviarlo igual produce un clic que muestra "Invitación no válida" y nadie sabe por qué.
    invitacion.mockResolvedValue({
      data: {
        email: "nuevo@ejemplo.com",
        clinic_id: "c-1",
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    })
    const res = await pedir({ token: "tok-9" })
    expect((await res.json()).sent).toBe(false)
    expect(sendTransactionalEmail).not.toHaveBeenCalled()
  })
})
