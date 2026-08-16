// La validación de "corregir un paciente". Lógica pura: sin base y sin React.
import { describe, expect, it } from "vitest"

import {
  PESO_MAXIMO_KG,
  validarPaciente,
  type CamposDePaciente,
} from "@/lib/pacientes/editar"

const HOY = "2026-08-16"

const BASE: CamposDePaciente = {
  name: "Pequitas",
  species: "Perro",
  breed: "Criollo",
  sex: "female",
  birthDate: "2020-03-15",
  weightKg: "12.5",
}

/** Atajo: valida `cambios` contra el mismo original. */
const validar = (cambios: Partial<CamposDePaciente>, original: CamposDePaciente = BASE) =>
  validarPaciente({ ...original, ...cambios }, original, HOY)

describe("qué se manda a la base", () => {
  // Devolver el diff y no el objeto entero es lo que hace que un guardado sin cambios no escriba
  // nada — ni toque `updated_at`.
  it("sin cambios no manda nada", () => {
    const r = validar({})
    expect(r).toEqual({ ok: true, cambios: {} })
  })

  it("manda SÓLO el campo que cambió", () => {
    const r = validar({ name: "Pequita" })
    expect(r).toEqual({ ok: true, cambios: { name: "Pequita" } })
  })

  it("los espacios de más no cuentan como un cambio", () => {
    expect(validar({ name: "  Pequitas  " })).toEqual({ ok: true, cambios: {} })
  })

  it("vaciar un campo opcional lo manda como null, no como cadena vacía", () => {
    expect(validar({ breed: "" })).toEqual({ ok: true, cambios: { breed: null } })
    expect(validar({ weightKg: "" })).toEqual({ ok: true, cambios: { weight_kg: null } })
    expect(validar({ birthDate: "" })).toEqual({ ok: true, cambios: { birth_date: null } })
  })

  it("el peso viaja como número, no como texto", () => {
    const r = validar({ weightKg: "13" })
    expect(r).toEqual({ ok: true, cambios: { weight_kg: 13 } })
  })

  // "12.5" y "12.50" son el mismo peso: si se comparara como texto, guardar sin tocar nada
  // escribiría igual.
  it("12.50 y 12.5 son el mismo peso", () => {
    expect(validar({ weightKg: "12.50" })).toEqual({ ok: true, cambios: {} })
  })

  it("varios campos a la vez viajan juntos", () => {
    const r = validar({ name: "Pequita", breed: "Mestizo", sex: "male" })
    expect(r).toEqual({
      ok: true,
      cambios: { name: "Pequita", breed: "Mestizo", sex: "male" },
    })
  })
})

describe("lo que no se deja guardar", () => {
  it("el nombre no puede quedar vacío", () => {
    const r = validar({ name: "   " })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errores.name).toBeTruthy()
  })

  it("la especie tampoco", () => {
    expect(validar({ species: "" }).ok).toBe(false)
  })

  it("un sexo inventado se rechaza", () => {
    expect(validar({ sex: "otro" }).ok).toBe(false)
  })

  it("el peso tiene que ser un número positivo", () => {
    expect(validar({ weightKg: "cinco" }).ok).toBe(false)
    expect(validar({ weightKg: "0" }).ok).toBe(false)
    expect(validar({ weightKg: "-3" }).ok).toBe(false)
  })

  // Caza-typos: "35" tecleado como "350". No es un dato veterinario.
  it("un peso absurdo se rechaza", () => {
    expect(validar({ weightKg: String(PESO_MAXIMO_KG + 1) }).ok).toBe(false)
    expect(validar({ weightKg: String(PESO_MAXIMO_KG) }).ok).toBe(true)
  })
})

describe("la fecha de nacimiento", () => {
  it("una fecha futura NUEVA se rechaza", () => {
    const r = validar({ birthDate: "2027-01-01" })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.errores.birthDate).toMatch(/futura/i)
  })

  it("hoy sí se acepta: un paciente puede haber nacido esta mañana", () => {
    expect(validar({ birthDate: HOY }).ok).toBe(true)
  })

  it("una fecha ilegible se rechaza", () => {
    expect(validar({ birthDate: "15/03/2020" }).ok).toBe(false)
    expect(validar({ birthDate: "2020-13-45" }).ok).toBe(false)
  })

  // EL CASO QUE JUSTIFICA LA REGLA. Medido contra el principal el 2026-08-16: 2 de 46 pacientes ya
  // tienen una fecha futura guardada. Validarla siempre le impediría al vet corregirles el NOMBRE
  // hasta que además les arreglara la fecha — castigar una edición por un dato que no está tocando.
  it("una fecha futura que YA estaba no bloquea corregir otra cosa", () => {
    const conFechaMala: CamposDePaciente = { ...BASE, birthDate: "2027-06-01" }

    const r = validarPaciente({ ...conFechaMala, name: "Pequita" }, conFechaMala, HOY)

    expect(r).toEqual({ ok: true, cambios: { name: "Pequita" } })
  })

  it("pero si la tocan, tiene que quedar bien", () => {
    const conFechaMala: CamposDePaciente = { ...BASE, birthDate: "2027-06-01" }

    const r = validarPaciente({ ...conFechaMala, birthDate: "2028-01-01" }, conFechaMala, HOY)

    expect(r.ok).toBe(false)
  })

  it("y siempre se la puede corregir hacia atrás", () => {
    const conFechaMala: CamposDePaciente = { ...BASE, birthDate: "2027-06-01" }

    const r = validarPaciente({ ...conFechaMala, birthDate: "2021-06-01" }, conFechaMala, HOY)

    expect(r).toEqual({ ok: true, cambios: { birth_date: "2021-06-01" } })
  })
})
