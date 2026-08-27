/**
 * Qué horas dibuja la grilla de la agenda.
 *
 * Lo que se fija acá es sobre todo UNA cosa: que acotar la grilla no esconda una cita. Ése es el
 * riesgo real del cambio — una cita fuera del rango no se dibuja recortada, DESAPARECE — y es el
 * tipo de defecto que nadie ve hasta el día de la urgencia de las 6 de la mañana.
 */
import { describe, expect, it } from "vitest"

import { comoFechas, rangoVisible, type FranjaHoraria } from "@/lib/agenda/rango-visible"

/** Una jornada normal: 8 a 18. */
const JORNADA: FranjaHoraria[] = [{ opens_at: "08:00:00", closes_at: "18:00:00" }]

/** Una cita, en horario LOCAL. Se construye con el constructor local para no depender de la zona. */
const cita = (hIni: number, mIni: number, hFin: number, mFin: number) => ({
  inicio: new Date(2026, 7, 27, hIni, mIni),
  fin: new Date(2026, 7, 27, hFin, mFin),
})

describe("sin horario cargado", () => {
  it("cae en una jornada usable, no en el día entero", () => {
    // Dibujar de 0 a 24 es justamente el defecto que esto viene a cerrar.
    expect(rangoVisible([])).toEqual({ desdeHora: 7, hastaHora: 20 })
  })

  it("una franja ilegible o vacía no cuenta", () => {
    expect(rangoVisible([{ opens_at: null, closes_at: null }])).toEqual({ desdeHora: 7, hastaHora: 20 })
    expect(rangoVisible([{ opens_at: "abierto", closes_at: "tarde" }])).toEqual({
      desdeHora: 7,
      hastaHora: 20,
    })
  })
})

describe("con el horario de la clínica", () => {
  it("acota a su jornada, con una hora de colchón a cada lado", () => {
    // El colchón evita que la primera cita quede pegada al borde y da lugar para arrastrar una
    // cita un rato antes de abrir.
    expect(rangoVisible(JORNADA)).toEqual({ desdeHora: 7, hastaHora: 19 })
  })

  it("toma la apertura más temprana y el cierre más tardío de TODA la semana", () => {
    // La vista de semana muestra siete días: si el sábado abre más temprano, esa fila tiene que
    // existir el sábado — y la grilla es una sola para los siete.
    const semana: FranjaHoraria[] = [
      { opens_at: "09:00:00", closes_at: "17:00:00" },
      { opens_at: "07:00:00", closes_at: "13:00:00" },
      { opens_at: "10:00:00", closes_at: "20:00:00" },
    ]
    expect(rangoVisible(semana)).toEqual({ desdeHora: 6, hastaHora: 21 })
  })

  it("un cierre con minutos sueltos dibuja su hora entera", () => {
    // Cerrar 18:30 necesita la fila de las 18 completa; contarla como 18 la cortaría a la mitad.
    expect(rangoVisible([{ opens_at: "08:00:00", closes_at: "18:30:00" }])).toEqual({
      desdeHora: 7,
      hastaHora: 20,
    })
  })

  it("una franja invertida se ignora en vez de estirar la grilla", () => {
    // Cerrar antes de abrir es un dato roto, no un turno nocturno. Tomarla en serio devolvería el
    // día entero, que es el defecto de origen.
    const rotas: FranjaHoraria[] = [
      { opens_at: "18:00:00", closes_at: "08:00:00" },
      { opens_at: "09:00:00", closes_at: "17:00:00" },
    ]
    expect(rangoVisible(rotas)).toEqual({ desdeHora: 8, hastaHora: 18 })
  })
})

describe("LA GARANTÍA: acotar no puede esconder una cita", () => {
  it("una urgencia antes de abrir estira la grilla hacia arriba", () => {
    const r = rangoVisible(JORNADA, [cita(6, 0, 6, 45)])
    expect(r.desdeHora).toBe(6)
  })

  it("una cirugía que se pasa del cierre la estira hacia abajo", () => {
    const r = rangoVisible(JORNADA, [cita(20, 0, 22, 30)])
    expect(r.hastaHora).toBe(23)
  })

  it("una cita de madrugada la estira hasta la madrugada", () => {
    // Fea, pero visible. Perderla sería peor que una grilla larga.
    const r = rangoVisible(JORNADA, [cita(2, 0, 3, 0)])
    expect(r.desdeHora).toBe(2)
  })

  it("estira por los dos lados a la vez", () => {
    const r = rangoVisible(JORNADA, [cita(6, 30, 7, 0), cita(21, 0, 21, 30)])
    expect(r).toEqual({ desdeHora: 6, hastaHora: 22 })
  })

  it("una cita DENTRO del horario no estira nada", () => {
    expect(rangoVisible(JORNADA, [cita(10, 0, 10, 30)])).toEqual({ desdeHora: 7, hastaHora: 19 })
  })

  it("una cita que termina en punto NO pide la fila siguiente", () => {
    // Terminar 19:00 no necesita que se dibuje la fila de las 19: ahí ya no hay nada.
    expect(rangoVisible(JORNADA, [cita(18, 0, 19, 0)]).hastaHora).toBe(19)
  })

  it("una cita con fecha ilegible no rompe ni estira", () => {
    const rota = { inicio: new Date("basura"), fin: new Date("basura") }
    expect(rangoVisible(JORNADA, [rota])).toEqual({ desdeHora: 7, hastaHora: 19 })
  })
})

describe("los bordes del día", () => {
  it("no se sale por arriba ni por abajo", () => {
    const r = rangoVisible([{ opens_at: "00:00:00", closes_at: "23:59:00" }])
    expect(r.desdeHora).toBeGreaterThanOrEqual(0)
    expect(r.hastaHora).toBeLessThanOrEqual(24)
  })

  it("nunca devuelve un rango invertido", () => {
    // Un rango invertido deja a react-big-calendar dibujando una grilla vacía, que es peor que una
    // larga: la agenda se ve rota en vez de incómoda.
    for (const f of [[], JORNADA, [{ opens_at: "23:00:00", closes_at: "23:30:00" }]]) {
      const r = rangoVisible(f as FranjaHoraria[])
      expect(r.hastaHora, JSON.stringify(f)).toBeGreaterThan(r.desdeHora)
    }
  })
})

describe("pasarlo a fechas para la librería", () => {
  it("arma las horas sobre el día de referencia", () => {
    const { min, max } = comoFechas({ desdeHora: 7, hastaHora: 19 }, new Date(2026, 7, 27, 15, 30))
    expect(min.getHours()).toBe(7)
    expect(min.getMinutes()).toBe(0)
    expect(max.getHours()).toBe(19)
    expect(min.getDate()).toBe(27)
    expect(max.getDate()).toBe(27)
  })

  it("las 24 se convierten en 23:59, NO en la medianoche siguiente", () => {
    // `max` a las 00:00 le dice a la librería que el rango termina donde empieza: grilla vacía.
    const { max } = comoFechas({ desdeHora: 0, hastaHora: 24 }, new Date(2026, 7, 27, 9, 0))
    expect(max.getHours()).toBe(23)
    expect(max.getMinutes()).toBe(59)
    expect(max.getDate()).toBe(27)
  })
})
