// El armado del enlace de invitación que va en el correo.
//
// Acá vivían dos de los cuatro bugs que el cliente reportó como "el enlace no hace nada":
//   1) `redirectTo` apuntaba a /invitar/<token>, que NO canjea el `?code=` de PKCE -> el invitado
//      aterrizaba sin sesión. Tiene que apuntar a /auth/callback.
//   2) el origen salía de `new URL(req.url).origin`, que en un deployment de preview es un dominio
//      efímero fuera de la allow-list de Supabase -> el enlace moría antes de llegar.
import { beforeEach, describe, expect, it, vi } from "vitest"

const inviteUserByEmail = vi.fn()
const getUser = vi.fn()
const perfil = vi.fn()
const invitacion = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: perfil }) }) }),
  }),
}))
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { inviteUserByEmail } },
    from: () => ({
      select: () => ({ eq: () => ({ is: () => ({ maybeSingle: invitacion }) }) }),
    }),
  }),
}))
vi.mock("@/lib/base-url", () => ({ getAppBaseUrl: () => "https://app.tuvetia.com" }))

import { POST } from "@/app/api/team/invite-email/route"

const pedir = (body: unknown) =>
  POST(new Request("https://efimero-abc123.vercel.app/api/team/invite-email", {
    method: "POST",
    body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: "admin-1" } } })
  perfil.mockResolvedValue({ data: { clinic_id: "c-1", role: "admin" } })
  invitacion.mockResolvedValue({ data: { email: "nuevo@ejemplo.com", clinic_id: "c-1" } })
  inviteUserByEmail.mockResolvedValue({ error: null })
})

describe("el enlace que recibe el invitado", () => {
  it("apunta a /auth/callback, NO a /invitar directo", async () => {
    await pedir({ token: "tok-9" })
    const [correo, opciones] = inviteUserByEmail.mock.calls[0]
    expect(correo).toBe("nuevo@ejemplo.com")
    expect(opciones.redirectTo).toBe(
      "https://app.tuvetia.com/auth/callback?next=%2Finvitar%2Ftok-9",
    )
  })

  it("usa el dominio estable, no el efímero del deployment", async () => {
    // La petición llega a efimero-abc123.vercel.app y ese origen NO debe aparecer en el enlace:
    // no está en la allow-list de Redirect URLs de Supabase.
    await pedir({ token: "tok-9" })
    const { redirectTo } = inviteUserByEmail.mock.calls[0][1]
    expect(redirectTo).not.toContain("efimero-abc123")
    expect(redirectTo.startsWith("https://app.tuvetia.com/")).toBe(true)
  })

  it("el `next` nunca viaja vacío", async () => {
    // Un `next` vacío rompía el enlace: la plantilla de Supabase concatena `&token_hash=` sobre él.
    await pedir({ token: "tok-9" })
    const { redirectTo } = inviteUserByEmail.mock.calls[0][1]
    expect(redirectTo).toMatch(/[?&]next=%2Finvitar%2F[^&]+$/)
  })
})

describe("autorización", () => {
  it("sin sesión no manda nada", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await pedir({ token: "tok-9" })).status).toBe(401)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it("un vet no puede invitar: solo administradores", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: "c-1", role: "vet" } })
    expect((await pedir({ token: "tok-9" })).status).toBe(403)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it("no se puede reenviar la invitación de OTRA clínica", async () => {
    invitacion.mockResolvedValue({ data: { email: "x@y.com", clinic_id: "otra-clinica" } })
    expect((await pedir({ token: "tok-9" })).status).toBe(404)
    expect(inviteUserByEmail).not.toHaveBeenCalled()
  })

  it("sin token responde 400", async () => {
    expect((await pedir({})).status).toBe(400)
  })
})

describe("degradación", () => {
  it("si el correo no sale, se reporta pero no se rompe: el enlace es el camino garantizado", async () => {
    inviteUserByEmail.mockResolvedValue({ error: { message: "email ya registrado" } })
    const res = await pedir({ token: "tok-9" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sent: false, reason: "email ya registrado" })
  })
})
