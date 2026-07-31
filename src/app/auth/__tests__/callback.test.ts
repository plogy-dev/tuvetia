// La ruta que convierte el enlace del correo en una sesión.
//
// Es el eslabón que el cliente reportó roto ("el enlace de la invitación no hacía nada"): el correo
// apuntaba a /invitar/<token>, que sólo LEE la sesión con getUser() y no canjea el `?code=` de PKCE.
// El invitado aterrizaba sin sesión y veía "Inicia sesión o crea tu cuenta". Ahora el correo apunta
// acá, se canjea el código y recién después se redirige.
//
// Estas pruebas cubren el camino del invitado SIN cuenta previa, que es donde viven 3 de los 4 bugs
// corregidos y lo único que no se pudo verificar con la invitación real del 30-jul (ese correo ya
// tenía cuenta de Google, así que Supabase no mandó magic link).
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const exchangeCodeForSession = vi.fn()
const from = vi.fn()

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { exchangeCodeForSession },
    from,
  }),
}))
vi.mock("@/lib/google-calendar", () => ({ upsertGoogleIntegration: vi.fn() }))

import { GET } from "@/app/auth/callback/route"

const USUARIO = { id: "u-1" }

function pedir(qs: string) {
  return GET(new NextRequest(`https://app.tuvetia.com/auth/callback${qs}`))
}

beforeEach(() => {
  vi.clearAllMocks()
  exchangeCodeForSession.mockResolvedValue({ data: { user: USUARIO, session: {} }, error: null })
  from.mockReturnValue({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
  })
})

describe("el canje del enlace del correo", () => {
  it("canjea el código y lleva a la invitación", async () => {
    const res = await pedir("?code=abc123&next=%2Finvitar%2Ftok-9")
    expect(exchangeCodeForSession).toHaveBeenCalledWith("abc123")
    expect(res.headers.get("location")).toBe("https://app.tuvetia.com/invitar/tok-9")
  })

  it("sin código deriva al navegador, que es el único que puede leer el fragmento", async () => {
    // Éste es el arreglo del invitado SIN cuenta. Un enlace de correo vuelve con la sesión en
    // `#access_token=…`, y el fragmento NO llega al servidor: acá se ve una petición sin código.
    // Antes eso terminaba en /login y la persona no entraba nunca. Ahora se le pregunta al
    // navegador, que sí puede leerlo (el fragmento sobrevive a la redirección, RFC 7231 §7.1.2).
    const res = await pedir("?next=%2Finvitar%2Ftok-9")
    expect(exchangeCodeForSession).not.toHaveBeenCalled()
    expect(res.headers.get("location")).toBe(
      "https://app.tuvetia.com/auth/sesion?next=%2Finvitar%2Ftok-9&reason=missing_code",
    )
  })

  it("el destino se sanea ANTES de derivar al navegador", async () => {
    const res = await pedir("?next=%2F%2Fevil.com")
    expect(res.headers.get("location")).toBe(
      "https://app.tuvetia.com/auth/sesion?next=%2Fdashboard&reason=missing_code",
    )
  })

  it("si el canje falla, el motivo real viaja al login", async () => {
    exchangeCodeForSession.mockResolvedValue({
      data: { user: null }, error: { code: "bad_code_verifier" },
    })
    const res = await pedir("?code=abc123")
    expect(res.headers.get("location")).toContain("reason=bad_code_verifier")
  })
})

describe("protección contra open redirect", () => {
  // Sin esto, un enlace de invitación manipulado dejaría al veterinario en un dominio ajeno YA
  // autenticado. El destino tiene que ser un path interno, y `//` no cuenta como interno.
  it.each([
    ["//evil.com", "protocolo relativo"],
    ["https://evil.com", "absoluto"],
    ["", "vacío"],
  ])("rechaza %s (%s) y cae al dashboard", async (next) => {
    const res = await pedir(`?code=abc123&next=${encodeURIComponent(next)}`)
    expect(res.headers.get("location")).toBe("https://app.tuvetia.com/dashboard")
  })

  it("sin `next` cae al dashboard", async () => {
    const res = await pedir("?code=abc123")
    expect(res.headers.get("location")).toBe("https://app.tuvetia.com/dashboard")
  })

  it("acepta un path interno", async () => {
    const res = await pedir("?code=abc123&next=%2Fdashboard%2Fcalendario")
    expect(res.headers.get("location")).toBe("https://app.tuvetia.com/dashboard/calendario")
  })
})

describe("vinculación de Google Calendar", () => {
  it("un fallo vinculando el calendario NO rompe el ingreso", async () => {
    // El invitado tiene que entrar aunque la vinculación reviente: si no, un problema de calendario
    // deja a alguien fuera de su clínica.
    exchangeCodeForSession.mockResolvedValue({
      data: { user: USUARIO, session: { provider_refresh_token: "rt-1" } }, error: null,
    })
    from.mockImplementation(() => {
      throw new Error("sin service_role")
    })
    const res = await pedir("?code=abc123&next=%2Finvitar%2Ftok-9")
    expect(res.headers.get("location")).toBe("https://app.tuvetia.com/invitar/tok-9")
  })
})
