// El horario que propone el onboarding.
//
// LO QUE SE PRUEBA ACÁ es que un día mal escrito no se lleve el paso entero. La tabla tiene
// `constraint clinic_hours_valid_range check (closes_at > opens_at)`: sin filtrar antes, un vet que
// invierte una hora recibe un error de Postgres en crudo a mitad del onboarding — y el objetivo de
// este paso es justamente quitar trabas, no agregar una nueva.

import { describe, expect, it } from "vitest"

import {
  HORARIO_SUGERIDO,
  NOMBRE_DEL_DIA,
  SLOT_POR_DEFECTO,
  diaValido,
  filasDeHorario,
} from "@/lib/onboarding/horarios-sugeridos"

const CLINICA = "cli-1"
const LUNES = { weekday: 1, opens_at: "08:00", closes_at: "18:00" }

describe("qué día se puede guardar", () => {
  it("uno normal sí", () => {
    expect(diaValido(LUNES)).toBe(true)
  })

  // El caso de la restricción de la tabla.
  it("cerrar antes de abrir, no", () => {
    expect(diaValido({ ...LUNES, opens_at: "18:00", closes_at: "08:00" })).toBe(false)
  })

  it("abrir y cerrar a la misma hora tampoco: es un día de cero minutos", () => {
    expect(diaValido({ ...LUNES, opens_at: "08:00", closes_at: "08:00" })).toBe(false)
  })

  it("una hora con formato roto, no", () => {
    expect(diaValido({ ...LUNES, opens_at: "8:00" })).toBe(false)
    expect(diaValido({ ...LUNES, closes_at: "" })).toBe(false)
  })

  // `check (weekday between 0 and 6)`.
  it("un weekday fuera de rango, no", () => {
    expect(diaValido({ ...LUNES, weekday: 7 })).toBe(false)
    expect(diaValido({ ...LUNES, weekday: -1 })).toBe(false)
  })
})

describe("armar las filas", () => {
  // LO QUE MÁS IMPORTA: un día inválido NO aborta el paso. Se guardan los buenos.
  it("descarta el día roto y conserva los demás", () => {
    const filas = filasDeHorario(CLINICA, [
      LUNES,
      { weekday: 2, opens_at: "18:00", closes_at: "08:00" }, // invertido
      { weekday: 3, opens_at: "08:00", closes_at: "18:00" },
    ])
    expect(filas.map((f) => f.weekday)).toEqual([1, 3])
  })

  it("sin días válidos devuelve lista vacía, no lanza", () => {
    expect(filasDeHorario(CLINICA, [{ weekday: 9, opens_at: "08:00", closes_at: "18:00" }])).toEqual([])
  })

  it("cada fila lleva su clínica y el turno por defecto de la tabla", () => {
    const [fila] = filasDeHorario(CLINICA, [LUNES])
    expect(fila).toEqual({
      clinic_id: CLINICA,
      // DE LA CLÍNICA Y NO DE UNA PERSONA (migración 0069). Lo que se carga en el asistente de
      // bienvenida es el horario de la puerta: si naciera con `vet_id` puesto, la clínica arrancaría
      // sin horario propio y ni el modo auto de WhatsApp ni el riel de configuración lo verían.
      vet_id: null,
      weekday: 1,
      opens_at: "08:00",
      closes_at: "18:00",
      slot_minutes: SLOT_POR_DEFECTO,
    })
  })
})

describe("el horario sugerido", () => {
  it("todos sus días son válidos — se propone lleno y tiene que poder guardarse tal cual", () => {
    expect(HORARIO_SUGERIDO.every(diaValido)).toBe(true)
    expect(filasDeHorario(CLINICA, HORARIO_SUGERIDO)).toHaveLength(HORARIO_SUGERIDO.length)
  })

  // Abrir domingo es la excepción. Proponerlo obligaría al caso común a BORRAR una fila, que es más
  // trabajo que agregarla.
  it("no incluye el domingo", () => {
    expect(HORARIO_SUGERIDO.some((d) => d.weekday === 0)).toBe(false)
  })

  it("no repite un día: `unique (clinic_id, weekday, opens_at)`", () => {
    const dias = HORARIO_SUGERIDO.map((d) => `${d.weekday}-${d.opens_at}`)
    expect(new Set(dias).size).toBe(dias.length)
  })

  it("los nombres de día están indexados como la tabla: 0 = domingo", () => {
    expect(NOMBRE_DEL_DIA[0]).toBe("Domingo")
    expect(NOMBRE_DEL_DIA[1]).toBe("Lunes")
    expect(NOMBRE_DEL_DIA[6]).toBe("Sábado")
    expect(NOMBRE_DEL_DIA).toHaveLength(7)
  })
})
