/**
 * El contrato con la plantilla de correo de Supabase, que vive FUERA del repo.
 *
 * POR QUÉ ESTE ARCHIVO. El enlace del magic link lo arma una plantilla en el panel de Supabase —no
 * hay código que la genere y no hay despliegue que la valide—. El repo pone las dos puntas: el
 * `emailRedirectTo` que sale del navegador y la ruta que recibe el clic. Si alguien cambia una de
 * las dos, el enlace se rompe en producción y ningún test se entera, porque el pedazo del medio no
 * está acá.
 *
 * Esto no puede probar la plantilla. Lo que hace es dejar ESCRITO el contrato en el único lugar que
 * se revisa —y que se rompe— cuando el código cambia.
 *
 * ── EL CONTRATO ────────────────────────────────────────────────────────────────────────────────
 *
 * El navegador manda:   {origin}/auth/confirm?next=<a-donde-volver>
 * La plantilla agrega:  &token_hash={{ .TokenHash }}&type=email
 * La ruta lee:          token_hash, type, next
 *
 * DE AHÍ SALEN DOS EXIGENCIAS QUE PARECEN DETALLES Y NO LO SON:
 *
 * 1. El `emailRedirectTo` SIEMPRE lleva `?next=`, aunque sea el valor por defecto. La plantilla
 *    concatena con `&`, así que una URL sin `?` produce `/auth/confirm&token_hash=…` — una sola
 *    query string mal formada, y el enlace no verifica nada.
 *
 * 2. La plantilla tiene que usar `{{ .RedirectTo }}` y NO `{{ .SiteURL }}`. Con `.SiteURL` se pierde
 *    el `next`, y ahí es donde viaja la invitación de equipo: quien es invitado llega por
 *    `/signup?next=/invitar/<token>` y, sin ese dato, termina en el tablero en vez de volver a
 *    aceptar su invitación.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { safeNext } from "@/lib/auth-fragment"

const leer = (rel: string) => readFileSync(join(process.cwd(), "src", ...rel.split("/")), "utf8")

const FORMULARIOS = [
  "components/login-form.tsx",
  "components/signup-form.tsx",
]

describe("las dos puntas del magic link", () => {
  it.each(FORMULARIOS)("%s manda a /auth/confirm con un ?next= ya puesto", (ruta) => {
    const src = leer(ruta)

    expect(src).toMatch(/emailRedirectTo:\s*`\$\{window\.location\.origin\}\/auth\/confirm\?next=/)
    // El `?` no es cosmético: la plantilla concatena con `&`. Sin él queda
    // `/auth/confirm&token_hash=…`, que no es una query string.
    expect(src).toMatch(/\/auth\/confirm\?next=\$\{encodeURIComponent\(next\)\}/)
    // Y `next` nunca queda vacío, por lo mismo.
    expect(src).toMatch(/get\("next"\)\s*\?\?\s*"\/dashboard"/)
  })

  it("la ruta que recibe el clic lee exactamente lo que la plantilla agrega", () => {
    const src = leer("app/auth/confirm/route.ts")

    expect(src).toMatch(/searchParams\.get\("token_hash"\)/)
    expect(src).toMatch(/searchParams\.get\("type"\)/)
    expect(src).toMatch(/searchParams\.get\("next"\)/)
    // `verifyOtp` con token_hash es el flujo SIN PKCE, que es el que funciona cuando el enlace se
    // abre en otro dispositivo — el caso que hacía que el magic link "no hiciera nada".
    expect(src).toMatch(/verifyOtp\(\{\s*type,\s*token_hash\s*\}\)/)
  })

  it("un `next` de otro sitio no se obedece", () => {
    // La plantilla no valida nada: lo que llegue en `next` entra tal cual. El guard está acá.
    expect(safeNext("/invitar/abc")).toBe("/invitar/abc")
    expect(safeNext("https://otro-sitio.com/robar")).toBe("/dashboard")
    expect(safeNext("//otro-sitio.com")).toBe("/dashboard")
    expect(safeNext(null)).toBe("/dashboard")
  })

  it("el procedimiento de configuración está escrito y dice usar RedirectTo", () => {
    // Si este archivo no existiera, el contrato viviría sólo en la cabeza de quien configuró el
    // panel — que es exactamente como se perdió antes.
    const doc = readFileSync(join(process.cwd(), "docs", "CONFIGURAR-MAGIC-LINK.md"), "utf8")
    expect(doc).toMatch(/\{\{ \.RedirectTo \}\}/)
    expect(doc).toMatch(/token_hash=\{\{ \.TokenHash \}\}/)
    expect(doc).toMatch(/type=email/)
  })
})
