import { describe, expect, it } from "vitest"

import { huecosDelDia } from "@/lib/agenda/huecos"

const DIA = "2026-08-12"
/** Bogotá: las horas locales se escriben con offset explícito para no depender del TZ de la máquina. */
const at = (hhmm: string) => `${DIA}T${hhmm}:00-05:00`

const MANANA_Y_TARDE = [
  { opens_at: "08:00", closes_at: "12:00" },
  { opens_at: "14:00", closes_at: "18:00" },
]

describe("huecosDelDia", () => {
  it("sin citas, cada franja de atención es un hueco entero", () => {
    const h = huecosDelDia({ date: DIA, franjas: MANANA_Y_TARDE, ocupados: [] })
    expect(h).toEqual([
      { desde: "08:00", hasta: "12:00", minutos: 240 },
      { desde: "14:00", hasta: "18:00", minutos: 240 },
    ])
  })

  it("una cita parte la franja en dos", () => {
    const h = huecosDelDia({
      date: DIA,
      franjas: [{ opens_at: "08:00", closes_at: "12:00" }],
      ocupados: [{ starts_at: at("10:00"), ends_at: at("10:30") }],
    })
    expect(h).toEqual([
      { desde: "08:00", hasta: "10:00", minutos: 120 },
      { desde: "10:30", hasta: "12:00", minutos: 90 },
    ])
  })

  it("dos citas PEGADAS no inventan un hueco de cero minutos entre ellas", () => {
    // Es la razón de que las ocupaciones se fusionen antes de restar. Sin eso, 10:00–10:30 y
    // 10:30–11:00 dejarían un "hueco" de 10:30 a 10:30.
    const h = huecosDelDia({
      date: DIA,
      franjas: [{ opens_at: "08:00", closes_at: "12:00" }],
      ocupados: [
        { starts_at: at("10:00"), ends_at: at("10:30") },
        { starts_at: at("10:30"), ends_at: at("11:00") },
      ],
    })
    expect(h).toEqual([
      { desde: "08:00", hasta: "10:00", minutos: 120 },
      { desde: "11:00", hasta: "12:00", minutos: 60 },
    ])
  })

  it("dos citas SOLAPADAS cuentan como un solo bloque ocupado", () => {
    const h = huecosDelDia({
      date: DIA,
      franjas: [{ opens_at: "08:00", closes_at: "12:00" }],
      ocupados: [
        { starts_at: at("09:00"), ends_at: at("11:00") },
        { starts_at: at("10:00"), ends_at: at("10:15") }, // contenida en la anterior
      ],
    })
    expect(h).toEqual([
      { desde: "08:00", hasta: "09:00", minutos: 60 },
      { desde: "11:00", hasta: "12:00", minutos: 60 },
    ])
  })

  it("descarta los huecos más cortos que el mínimo", () => {
    // Un hueco de 15 minutos no es ofrecible: no cabe una consulta. Ofrecerlo sería ruido.
    const h = huecosDelDia({
      date: DIA,
      franjas: [{ opens_at: "08:00", closes_at: "12:00" }],
      ocupados: [
        { starts_at: at("08:00"), ends_at: at("10:00") },
        { starts_at: at("10:15"), ends_at: at("12:00") },
      ],
      minimoMinutos: 30,
    })
    expect(h).toEqual([])
  })

  it("una cita de la tarde NO parte la franja de la mañana", () => {
    const h = huecosDelDia({
      date: DIA,
      franjas: MANANA_Y_TARDE,
      ocupados: [{ starts_at: at("15:00"), ends_at: at("16:00") }],
    })
    expect(h).toEqual([
      { desde: "08:00", hasta: "12:00", minutos: 240 },
      { desde: "14:00", hasta: "15:00", minutos: 60 },
      { desde: "16:00", hasta: "18:00", minutos: 120 },
    ])
  })

  it("una cita que se pasa del cierre no genera un hueco negativo", () => {
    const h = huecosDelDia({
      date: DIA,
      franjas: [{ opens_at: "08:00", closes_at: "12:00" }],
      ocupados: [{ starts_at: at("11:00"), ends_at: at("13:00") }],
    })
    expect(h).toEqual([{ desde: "08:00", hasta: "11:00", minutos: 180 }])
  })

  it("el día completamente ocupado no deja huecos", () => {
    const h = huecosDelDia({
      date: DIA,
      franjas: [{ opens_at: "08:00", closes_at: "12:00" }],
      ocupados: [{ starts_at: at("08:00"), ends_at: at("12:00") }],
    })
    expect(h).toEqual([])
  })

  it("tolera `HH:mm:ss` en las franjas, que es como las devuelve la base", () => {
    const h = huecosDelDia({
      date: DIA,
      franjas: [{ opens_at: "08:00:00", closes_at: "12:00:00" }],
      ocupados: [],
    })
    expect(h).toEqual([{ desde: "08:00", hasta: "12:00", minutos: 240 }])
  })
})
