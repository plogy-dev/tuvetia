// La validación de "corregir un titular". Lógica pura: sin base y sin React.
import { describe, expect, it } from "vitest"

import { validarTitular, type CamposDeTitular } from "@/lib/titulares/editar"

const BASE: CamposDeTitular = {
  fullName: "Marta Restrepo",
  phone: "3001234567",
  email: "marta@example.com",
  documentId: "52.111.222",
  address: "Cra 7 # 45-10",
}

/** Atajo: valida `cambios` contra el mismo original. */
const validar = (cambios: Partial<CamposDeTitular>, original: CamposDeTitular = BASE) =>
  validarTitular({ ...original, ...cambios }, original)

describe("qué se manda a la base", () => {
  // El diff es la garantía de que un guardado sin cambios no escribe nada.
  it("sin cambios no manda nada", () => {
    expect(validar({})).toEqual({ ok: true, cambios: {} })
  })

  it("manda SÓLO el campo que cambió", () => {
    expect(validar({ phone: "3009999999" })).toEqual({
      ok: true,
      cambios: { phone: "3009999999" },
    })
  })

  it("los espacios de más no cuentan como un cambio", () => {
    expect(validar({ fullName: "  Marta Restrepo  " })).toEqual({ ok: true, cambios: {} })
  })

  it("vaciar un campo opcional lo manda como null, no como cadena vacía", () => {
    expect(validar({ phone: "" })).toEqual({ ok: true, cambios: { phone: null } })
    expect(validar({ address: "" })).toEqual({ ok: true, cambios: { address: null } })
  })

  // El porqué de fondo de este archivo: en `notes` viven anotaciones libres y los marcadores de
  // datos sembrados ([demo TuvetIA]). Si el payload pudiera nombrarla, un guardado la pisaría.
  it("`notes` no puede viajar en el payload, cambie lo que cambie", () => {
    const r = validar({ fullName: "Marta R.", phone: "", email: "otra@example.com" })
    expect(r.ok).toBe(true)
    if (r.ok) expect(Object.keys(r.cambios)).not.toContain("notes")
  })
})

describe("qué se rechaza y qué se perdona", () => {
  it("el nombre no puede quedar vacío", () => {
    const r = validar({ fullName: "   " })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.fullName).toBeTruthy()
  })

  it("un correo nuevo malformado se rechaza", () => {
    const r = validar({ email: "esto-no-es-un-correo" })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errores.email).toBeTruthy()
  })

  // La lección de la fecha de nacimiento en pacientes: un dato viejo inválido que NO se está
  // tocando no puede bloquear la corrección de otro campo.
  it("un correo heredado malformado no bloquea corregir el teléfono", () => {
    const original = { ...BASE, email: "sin-arroba" }
    expect(validar({ phone: "3015555555" }, original)).toEqual({
      ok: true,
      cambios: { phone: "3015555555" },
    })
  })
})
