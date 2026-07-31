// El fragmento con el que Supabase devuelve la sesión de un enlace de correo.
//
// Es el camino del invitado que NO tiene cuenta — el que dejaba a la gente en el login. Los formatos
// de acá son los capturados de producción con `scripts/verificar_enlace_invitacion.py`.
import { describe, expect, it } from "vitest"

import { parseAuthFragment, safeNext } from "@/lib/auth-fragment"

describe("parseAuthFragment", () => {
  it("lee la sesión de un enlace de invitación real", () => {
    const hash =
      "#access_token=eyJhbG.aaa&expires_at=1785463495&expires_in=3600" +
      "&refresh_token=rt_bbb&sb=&token_type=bearer&type=invite"
    expect(parseAuthFragment(hash)).toEqual({
      tipo: "sesion",
      accessToken: "eyJhbG.aaa",
      refreshToken: "rt_bbb",
    })
  })

  it("reconoce un enlace vencido", () => {
    const hash =
      "#error=access_denied&error_code=otp_expired" +
      "&error_description=Email+link+is+invalid+or+has+expired"
    expect(parseAuthFragment(hash)).toEqual({ tipo: "error", motivo: "otp_expired" })
  })

  it("cae a `error` si sólo viene el genérico", () => {
    expect(parseAuthFragment("#error=access_denied")).toEqual({
      tipo: "error", motivo: "access_denied",
    })
  })

  it("sin fragmento devuelve vacío", () => {
    for (const h of ["", "#", null, undefined]) {
      expect(parseAuthFragment(h)).toEqual({ tipo: "vacio" })
    }
  })

  it("un fragmento a medias NO se toma por sesión", () => {
    // Media sesión es peor que ninguna: setSession fallaría con un error opaco.
    expect(parseAuthFragment("#access_token=solo_este")).toEqual({ tipo: "vacio" })
    expect(parseAuthFragment("#refresh_token=solo_este")).toEqual({ tipo: "vacio" })
  })

  it("funciona con o sin la almohadilla", () => {
    const sin = parseAuthFragment("access_token=a&refresh_token=b")
    expect(sin).toEqual({ tipo: "sesion", accessToken: "a", refreshToken: "b" })
  })
})

describe("safeNext", () => {
  it("acepta paths internos", () => {
    expect(safeNext("/invitar/tok-9")).toBe("/invitar/tok-9")
    expect(safeNext("/dashboard/calendario")).toBe("/dashboard/calendario")
  })

  it.each<[string | null | undefined, string]>([
    ["//evil.com", "protocolo relativo"],
    ["https://evil.com", "absoluto"],
    ["", "vacío"],
    [null, "nulo"],
    [undefined, "ausente"],
  ])("rechaza %s (%s)", (entrada) => {
    // Sin esto, un enlace de invitación manipulado dejaría al veterinario en un dominio ajeno
    // YA autenticado.
    expect(safeNext(entrada)).toBe("/dashboard")
  })
})
