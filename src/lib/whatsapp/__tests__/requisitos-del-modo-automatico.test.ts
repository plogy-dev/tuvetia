/**
 * Lo que la pantalla le dice al vet sobre el modo automático.
 *
 * David lo activó el 27-ago y no pasó nada. El interruptor decía «Activadas» y VetGPT no contestó
 * ni un mensaje, porque `auto-reply.ts` comprueba cuatro cosas más antes de responder y, si falta
 * una, guarda silencio. Lo que se prueba acá es que la pantalla pueda decirlo ANTES: que ninguna
 * condición se dé por cumplida sin serlo, y que el número de respuestas que promete sea el mismo
 * que el servidor va a respetar.
 *
 * El test del límite es el que más importa: es una RÉPLICA de la rampa de `auto-reply.ts`, y una
 * réplica que se desincroniza es peor que no tener nada — la pantalla prometería 30 respuestas
 * mientras el servidor manda 5.
 */
import { describe, expect, it } from "vitest"

import {
  MAXIMO_POR_CHAT_POR_HORA,
  RESPUESTAS_DEL_PRIMER_DIA,
  estaCalentandoElNumero,
  limiteDeRespuestasDeHoy,
  puedeEncenderse,
  requisitosDelModoAutomatico,
} from "@/lib/whatsapp/requisitos-del-modo-automatico"

const TODO_BIEN = { conectado: true, planPro: true, esAdmin: true }

const requisito = (estado: Parameters<typeof requisitosDelModoAutomatico>[0], id: string) =>
  requisitosDelModoAutomatico(estado).find((r) => r.id === id)!

describe("requisitosDelModoAutomatico — por qué no responde", () => {
  it("con todo en su sitio no queda ninguna condición pendiente", () => {
    expect(puedeEncenderse(requisitosDelModoAutomatico(TODO_BIEN))).toBe(true)
  })

  it("una clínica en plan gratis se entera ACÁ, no después de encender y esperar", () => {
    // Es la causa más probable del caso de David: `auto-reply.ts` corta por plan sin avisarle a
    // nadie, porque corre desde el webhook y no tiene a quién avisarle.
    const r = requisito({ ...TODO_BIEN, planPro: false }, "plan")
    expect(r.cumplido).toBe(false)
    expect(r.texto).toMatch(/Pro/)
  })

  it("sin la línea conectada no hay nada que responder, y lo dice sin hablar de integraciones", () => {
    const r = requisito({ ...TODO_BIEN, conectado: false }, "conexion")
    expect(r.cumplido).toBe(false)
    // Un veterinario no tiene por qué saber qué es una integración ni un `status`.
    expect(r.texto).not.toMatch(/integraci|status|agent_mode/i)
  })

  it("a quien no es administrador le dice que se lo pida a quien sí lo es", () => {
    // El corte real está en `api/whatsapp/agent-mode` (`requireClinicAdmin`). Un botón muerto sin
    // explicación deja al vet creyendo que la función está rota.
    const r = requisito({ ...TODO_BIEN, esAdmin: false }, "rol")
    expect(r.cumplido).toBe(false)
    expect(r.texto).toMatch(/administrador/i)
  })

  it("basta con que falte UNA para que el interruptor no deba dejarse encender", () => {
    for (const roto of [{ conectado: false }, { planPro: false }, { esAdmin: false }]) {
      expect(puedeEncenderse(requisitosDelModoAutomatico({ ...TODO_BIEN, ...roto }))).toBe(false)
    }
  })

  it("los cuatro requisitos se pintan siempre, cumplidos o no", () => {
    // Una lista que sólo muestra lo que falta no responde «¿y qué SÍ tengo?», que es la otra mitad
    // de la pregunta cuando algo no funciona.
    expect(requisitosDelModoAutomatico(TODO_BIEN).map((r) => r.id)).toEqual([
      "conexion",
      "plan",
      "rol",
      "horarios",
    ])
  })

  // ── LA DECISIÓN DE PRODUCTO, ESCRITA PARA QUE NO SE CAMBIE SIN QUERER ────────────────────────
  //
  // `horarios` avisa pero NO bloquea. Si alguien convierte `puedeEncenderse` en un `every` a secas,
  // el interruptor se apaga para las clínicas que hoy lo tienen encendido sin horarios cargados —
  // incluida la del incidente del 30-ago— y se encuentran con algo que ya no pueden volver a
  // prender. Es una decisión, no un descuido, y este test es donde está anotada.
  it("sin horarios AVISA pero deja encender igual", () => {
    const sinHorarios = requisitosDelModoAutomatico({ ...TODO_BIEN, tieneHorarios: false })
    const horarios = sinHorarios.find((r) => r.id === "horarios")!

    expect(horarios.cumplido).toBe(false)
    expect(horarios.bloqueante).toBe(false)
    // Tiene que decir qué hacer, no sólo qué pasa: sin el dónde, el vet lee el problema y no lo
    // puede arreglar. Fue exactamente el caso del 30-ago.
    expect(horarios.texto).toMatch(/Administración/i)
    expect(puedeEncenderse(sinHorarios)).toBe(true)
  })

  it("sin el dato, no se afirma que falten horarios", () => {
    // `tieneHorarios` es opcional: quien no lo consulte no debería ver una advertencia inventada.
    const requisitos = requisitosDelModoAutomatico(TODO_BIEN)
    expect(requisitos.find((r) => r.id === "horarios")!.cumplido).toBe(true)
  })

  it("los tres que sí bloquean siguen bloqueando", () => {
    for (const id of ["conexion", "plan", "rol"] as const) {
      expect(requisitosDelModoAutomatico(TODO_BIEN).find((r) => r.id === id)!.bloqueante, id).toBe(true)
    }
  })
})

describe("limiteDeRespuestasDeHoy — la rampa de calentamiento, replicada", () => {
  const AHORA = new Date("2026-08-27T15:00:00.000Z")
  const haceDias = (d: number) => new Date(AHORA.getTime() - d * 86_400_000).toISOString()

  it("el día que se conecta son CINCO, no las 30 de la columna", () => {
    // El número que sorprende: se conecta, enciende el modo automático, prueba dos veces y ya
    // gastó casi la mitad del día sin saber que existía un tope.
    expect(limiteDeRespuestasDeHoy(30, haceDias(0), AHORA)).toBe(RESPUESTAS_DEL_PRIMER_DIA)
  })

  it("sube de a cinco por día conectado", () => {
    expect(limiteDeRespuestasDeHoy(30, haceDias(1), AHORA)).toBe(10)
    expect(limiteDeRespuestasDeHoy(30, haceDias(3), AHORA)).toBe(20)
  })

  it("no pasa nunca del tope configurado de la clínica", () => {
    // La rampa daría 50 al noveno día; el techo lo pone la columna.
    expect(limiteDeRespuestasDeHoy(30, haceDias(9), AHORA)).toBe(30)
    expect(limiteDeRespuestasDeHoy(10, haceDias(9), AHORA)).toBe(10)
  })

  it("un tope de 0 apaga el modo automático y la pantalla no promete respuestas", () => {
    // `auto_daily_limit` acepta 0 (check 0..500): es el kill-switch por clínica.
    expect(limiteDeRespuestasDeHoy(0, haceDias(30), AHORA)).toBe(0)
  })

  it("sin fecha de conexión cuenta como el día 0 — igual que `auto-reply.ts`", () => {
    expect(limiteDeRespuestasDeHoy(30, null, AHORA)).toBe(RESPUESTAS_DEL_PRIMER_DIA)
  })

  it("un reloj corrido no puede pintar «hasta -5 respuestas hoy»", () => {
    // `connected_at` en el futuro. En el servidor eso se traduce en silencio; acá se traduciría en
    // una frase absurda, así que se acota en 0.
    const futuro = new Date(AHORA.getTime() + 3 * 86_400_000).toISOString()
    expect(limiteDeRespuestasDeHoy(30, futuro, AHORA)).toBe(0)
  })

  it("avisa que está calentando sólo mientras la rampa esté por debajo del tope", () => {
    // El «por qué son cinco y no treinta» sólo hay que explicarlo mientras sea cierto; después
    // sería ruido en una pantalla que ya tiene bastante.
    expect(estaCalentandoElNumero(30, haceDias(0), AHORA)).toBe(true)
    expect(estaCalentandoElNumero(30, haceDias(9), AHORA)).toBe(false)
  })
})

describe("los topes que la pantalla promete son los del servidor", () => {
  it("el anti-loop por chat sigue siendo 8 por hora", () => {
    // Espeja `MAX_PER_HOUR_PER_CONVERSATION` de `auto-reply.ts`. Si allá cambia y acá no, la
    // pantalla miente sobre cuántas veces puede contestarle al mismo titular.
    expect(MAXIMO_POR_CHAT_POR_HORA).toBe(8)
  })

  it("el primer día son 5, como la rampa del servidor", () => {
    expect(RESPUESTAS_DEL_PRIMER_DIA).toBe(5)
  })
})
