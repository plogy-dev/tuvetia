// El orden de revisión de /admin/usuarios. Es lógica pura: se prueba sin base y sin React.
import { describe, expect, it } from "vitest"

import {
  DIAS_PARA_DORMIDA,
  ordenarPorRiesgo,
  puntajeDe,
  señalesDe,
} from "@/lib/admin/riesgo"
import type { PlatformUser } from "@/lib/admin/users"

const AHORA = new Date("2026-08-16T12:00:00Z")

/** Una cuenta sin nada que llame la atención. Cada test cambia sólo lo suyo. */
function usuario(cambios: Partial<PlatformUser> = {}): PlatformUser {
  return {
    id: "u1",
    email: "vet@clinica.com",
    fullName: "Dra. Ruiz",
    phone: null,
    role: "vet",
    isActive: true,
    clinics: ["Clínica Norte"],
    activeClinic: "Clínica Norte",
    clinicPhone: null,
    clinicEmail: null,
    city: "Bogotá",
    createdAt: "2026-08-01T00:00:00Z",
    lastSignInAt: "2026-08-15T00:00:00Z",
    nuncaEntro: false,
    ...cambios,
  }
}

const haceDias = (n: number) => new Date(AHORA.getTime() - n * 86_400_000).toISOString()

describe("señalesDe", () => {
  it("una cuenta normal no levanta ninguna señal", () => {
    expect(señalesDe(usuario(), AHORA)).toEqual([])
    expect(puntajeDe(usuario(), AHORA)).toBe(0)
  })

  it("registrarse y no entrar nunca es la señal más fuerte", () => {
    const u = usuario({ nuncaEntro: true, lastSignInAt: null })
    expect(señalesDe(u, AHORA)).toContain("nunca-entro")
    expect(puntajeDe(u, AHORA)).toBeGreaterThan(puntajeDe(usuario({ clinics: [] }), AHORA))
  })

  it("quedar fuera de toda clínica cuenta", () => {
    expect(señalesDe(usuario({ clinics: [], activeClinic: null }), AHORA)).toContain("sin-clinica")
  })

  it("sin correo cuenta", () => {
    expect(señalesDe(usuario({ email: null }), AHORA)).toContain("sin-correo")
  })

  it("dormida sólo a partir del umbral", () => {
    const justoAntes = usuario({ lastSignInAt: haceDias(DIAS_PARA_DORMIDA - 1) })
    const justoDespues = usuario({ lastSignInAt: haceDias(DIAS_PARA_DORMIDA) })
    expect(señalesDe(justoAntes, AHORA)).not.toContain("dormida")
    expect(señalesDe(justoDespues, AHORA)).toContain("dormida")
  })

  // Contar las dos sería contar el mismo hecho dos veces, y dejaría a quien nunca entró compitiendo
  // por el tope de la lista con una ventaja artificial.
  it("quien nunca entró NO cuenta además como dormida", () => {
    const s = señalesDe(usuario({ nuncaEntro: true, lastSignInAt: null }), AHORA)
    expect(s).toContain("nunca-entro")
    expect(s).not.toContain("dormida")
  })

  it("una fecha ilegible no inventa una señal", () => {
    expect(señalesDe(usuario({ lastSignInAt: "ayer por la tarde" }), AHORA)).toEqual([])
  })

  it("las señales se acumulan", () => {
    const u = usuario({ nuncaEntro: true, lastSignInAt: null, clinics: [], email: null })
    expect(señalesDe(u, AHORA)).toHaveLength(3)
  })
})

describe("ordenarPorRiesgo", () => {
  it("lo que más llama la atención va primero", () => {
    const limpia = usuario({ id: "limpia" })
    const sinClinica = usuario({ id: "sin-clinica", clinics: [], activeClinic: null })
    const nuncaEntro = usuario({ id: "nunca", nuncaEntro: true, lastSignInAt: null })

    const orden = ordenarPorRiesgo([limpia, sinClinica, nuncaEntro], AHORA).map((u) => u.id)

    expect(orden).toEqual(["nunca", "sin-clinica", "limpia"])
  })

  // Ya se actuó sobre ellas. Dejarlas arriba llena la cabecera con el trabajo hecho, que es lo que
  // hace que una lista de revisión se deje de leer.
  it("las desactivadas van al fondo aunque acumulen señales", () => {
    const desactivada = usuario({
      id: "desactivada",
      isActive: false,
      nuncaEntro: true,
      lastSignInAt: null,
      clinics: [],
      email: null,
    })
    const limpia = usuario({ id: "limpia" })

    expect(ordenarPorRiesgo([desactivada, limpia], AHORA).map((u) => u.id)).toEqual([
      "limpia",
      "desactivada",
    ])
  })

  // `is_active` es `null` en los perfiles anteriores a que existiera la columna. Tratarlos como
  // desactivados los mandaría al fondo y los sacaría de la revisión sin que nadie lo decidiera.
  it("is_active null NO cuenta como desactivada", () => {
    const vieja = usuario({ id: "vieja", isActive: null, nuncaEntro: true, lastSignInAt: null })
    const limpia = usuario({ id: "limpia" })

    expect(ordenarPorRiesgo([vieja, limpia], AHORA).map((u) => u.id)).toEqual(["vieja", "limpia"])
  })

  it("a igual puntaje, la más nueva primero", () => {
    const vieja = usuario({ id: "vieja", createdAt: "2026-01-01T00:00:00Z" })
    const nueva = usuario({ id: "nueva", createdAt: "2026-08-10T00:00:00Z" })

    expect(ordenarPorRiesgo([vieja, nueva], AHORA).map((u) => u.id)).toEqual(["nueva", "vieja"])
  })

  it("no muta la lista que recibe", () => {
    const lista = [usuario({ id: "a" }), usuario({ id: "b", nuncaEntro: true, lastSignInAt: null })]
    const copia = [...lista]
    ordenarPorRiesgo(lista, AHORA)
    expect(lista).toEqual(copia)
  })

  it("una lista vacía no revienta", () => {
    expect(ordenarPorRiesgo([], AHORA)).toEqual([])
  })
})
