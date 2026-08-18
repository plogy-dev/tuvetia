// Cuándo se le pide a Athos que mire la consulta en curso.
//
// LO QUE ESTOS TESTS PROTEGEN ES LA FACTURA. El tope es 1000 llamadas por clínica y por mes, y la
// clínica más intensa medida gastó 38 en todo el mes. A intervalo fijo, una sola consulta de 15
// minutos gastaría 80. La regla "por contenido, no por reloj" es lo único que separa esta función de
// una fuga, y es exactamente la clase de regla que se rompe sin que nada falle a la vista: seguiría
// funcionando, sólo que cara.

import { describe, expect, it } from "vitest"

import {
  NOTAS,
  NUNCA,
  SUGERENCIAS,
  contarPalabras,
  debeDisparar,
  techoDeLlamadas,
  trasDisparar,
  type EstadoDisparo,
} from "@/lib/consulta-viva/disparador"

/** Texto de `n` palabras, para no escribir párrafos a mano. */
const palabras = (n: number) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(" ")

describe("contar palabras", () => {
  it("lo vacío no es material", () => {
    expect(contarPalabras("")).toBe(0)
    expect(contarPalabras("   \n  ")).toBe(0)
  })

  it("los espacios de más no inflan la cuenta", () => {
    expect(contarPalabras("  el   gato   vomita  ")).toBe(3)
  })

  // Un micrófono mal puesto produce puntuación suelta. No es habla.
  it("la puntuación suelta no cuenta como palabra", () => {
    expect(contarPalabras("... — , ;")).toBe(0)
    expect(contarPalabras("el gato , vomita .")).toBe(3)
  })

  it("cuenta acentos y números como parte de la palabra", () => {
    expect(contarPalabras("pesó 4.2 kg según la báscula")).toBe(6)
  })
})

describe("el piso de CONTENIDO: no se gasta en silencio", () => {
  it("sin texto no dispara, por mucho que pase el tiempo", () => {
    expect(debeDisparar(NOTAS, 600, "", NUNCA)).toBe(false)
  })

  // EL CASO QUE MOTIVA TODO. La exploración física, la espera, el titular buscando algo en el bolso:
  // pasa el tiempo, no hay habla nueva, y un reloj habría disparado igual.
  it("con el tiempo cumplido pero SIN habla nueva, no dispara", () => {
    const ya: EstadoDisparo = { ultimoEn: 30, palabrasEntonces: 100, disparos: 1 }
    expect(debeDisparar(NOTAS, 300, palabras(100), ya)).toBe(false)
  })

  it("con poco texto nuevo tampoco", () => {
    const ya: EstadoDisparo = { ultimoEn: 30, palabrasEntonces: 100, disparos: 1 }
    expect(debeDisparar(NOTAS, 300, palabras(100 + NOTAS.minPalabrasNuevas - 1), ya)).toBe(false)
  })

  it("con el material justo, sí", () => {
    const ya: EstadoDisparo = { ultimoEn: 30, palabrasEntonces: 100, disparos: 1 }
    expect(debeDisparar(NOTAS, 300, palabras(100 + NOTAS.minPalabrasNuevas), ya)).toBe(true)
  })
})

describe("el piso de TIEMPO: no se dispara en ráfaga", () => {
  it("con material de sobra pero sin haber pasado el tiempo, espera", () => {
    const ya: EstadoDisparo = { ultimoEn: 100, palabrasEntonces: 0, disparos: 1 }
    expect(debeDisparar(NOTAS, 100 + NOTAS.minSegundos - 1, palabras(1000), ya)).toBe(false)
  })

  it("cumplido el tiempo, dispara", () => {
    const ya: EstadoDisparo = { ultimoEn: 100, palabrasEntonces: 0, disparos: 1 }
    expect(debeDisparar(NOTAS, 100 + NOTAS.minSegundos, palabras(1000), ya)).toBe(true)
  })

  it("el primer disparo cuenta desde el arranque de la grabación", () => {
    expect(debeDisparar(NOTAS, NOTAS.minSegundos - 1, palabras(1000), NUNCA)).toBe(false)
    expect(debeDisparar(NOTAS, NOTAS.minSegundos, palabras(1000), NUNCA)).toBe(true)
  })
})

// Los dos pisos juntos no acotan el TOTAL: una consulta de 90 minutos hablando sin parar los cumple
// cientos de veces. Es la misma lección que ya está escrita en presupuesto.ts.
describe("el techo por consulta", () => {
  it("agotado el techo, no dispara aunque se cumpla todo lo demás", () => {
    const agotado: EstadoDisparo = {
      ultimoEn: 0,
      palabrasEntonces: 0,
      disparos: NOTAS.maxPorConsulta,
    }
    expect(debeDisparar(NOTAS, 9999, palabras(99999), agotado)).toBe(false)
  })

  it("una llamada antes del techo, todavía dispara", () => {
    const casi: EstadoDisparo = {
      ultimoEn: 0,
      palabrasEntonces: 0,
      disparos: NOTAS.maxPorConsulta - 1,
    }
    expect(debeDisparar(NOTAS, 9999, palabras(99999), casi)).toBe(true)
  })

  it("las sugerencias tienen su propio techo, más bajo: llevan literatura detrás", () => {
    expect(SUGERENCIAS.maxPorConsulta).toBeLessThan(NOTAS.maxPorConsulta)
  })

  // EL NÚMERO QUE HAY QUE PODER DECIR EN VOZ ALTA cuando se discuta el precio, y el que el cliente
  // fijó el 2026-08-18: "duplica las consultas al mes".
  //
  // Se lee al revés de como se elige normalmente — no es cuánta inteligencia lleva una consulta,
  // sino cuántas consultas tienen que caber en el mes:
  //
  //     1000 llamadas/mes ÷ techo por consulta = consultas al mes por clínica
  //
  // Este test es el que impide que alguien suba el techo "un poquito" y baje esa cuenta sin querer.
  it("caben al menos 62 consultas al mes por clínica", () => {
    expect(techoDeLlamadas()).toBe(NOTAS.maxPorConsulta + SUGERENCIAS.maxPorConsulta)

    const TOPE_MENSUAL = 1000 // `athos-agent/presupuesto.ts :: TOPE_DE_SEGURIDAD`
    const consultasAlMes = Math.floor(TOPE_MENSUAL / techoDeLlamadas())
    expect(
      consultasAlMes,
      "subir el techo por consulta baja cuántas consultas entran en el mes: era 31, el cliente pidió duplicarlo",
    ).toBeGreaterThanOrEqual(62)
  })
})

describe("las cadencias son las que se acordaron", () => {
  it("las notas van en la ventana de 15-20 s que se pidió", () => {
    expect(NOTAS.minSegundos).toBeGreaterThanOrEqual(15)
    expect(NOTAS.minSegundos).toBeLessThanOrEqual(20)
  })

  it("las sugerencias, a 45 s", () => {
    expect(SUGERENCIAS.minSegundos).toBe(45)
  })

  // ~150 palabras/minuto es la velocidad normal de conversación: los pisos de contenido tienen que
  // ser alcanzables hablando de corrido, o la cadencia pedida no se cumple nunca.
  it("hablando de corrido, los pisos de contenido se alcanzan dentro de su ventana", () => {
    const porSegundo = 150 / 60
    for (const c of [NOTAS, SUGERENCIAS]) {
      const segundosQueExige = c.minPalabrasNuevas / porSegundo
      expect(segundosQueExige, `${c.nombre} exige más habla de la que cabe en su ventana`)
        .toBeLessThanOrEqual(c.minSegundos + 5)
    }
  })
})

describe("avanzar el estado", () => {
  it("guarda el momento, el texto y suma un disparo", () => {
    const d = trasDisparar(120, palabras(300), NUNCA)
    expect(d).toEqual({ ultimoEn: 120, palabrasEntonces: 300, disparos: 1 })
  })

  it("justo después de disparar, no vuelve a disparar", () => {
    const texto = palabras(300)
    const d = trasDisparar(120, texto, NUNCA)
    expect(debeDisparar(NOTAS, 120, texto, d)).toBe(false)
  })

  // La secuencia completa de una consulta que habla sin parar: cada disparo exige material NUEVO,
  // así que el texto tiene que seguir creciendo para que siga disparando.
  it("una consulta corrida dispara a su ritmo y no más", () => {
    let estado = NUNCA
    let disparos = 0
    let dichas = 0
    for (let s = 1; s <= 300; s++) {
      dichas += 150 / 60 // habla continua
      const texto = palabras(Math.floor(dichas))
      if (debeDisparar(NOTAS, s, texto, estado)) {
        estado = trasDisparar(s, texto, estado)
        disparos++
      }
    }
    // 5 minutos hablando sin parar. Con un reloj de 15 s serían 20; acá manda el material.
    expect(disparos).toBeGreaterThan(0)
    expect(disparos).toBeLessThanOrEqual(20)
    expect(estado.disparos).toBe(disparos)
  })

  it("una consulta CALLADA no gasta nada", () => {
    let estado = NUNCA
    let disparos = 0
    const texto = palabras(10) // se dijo algo al principio y después silencio
    for (let s = 1; s <= 600; s++) {
      if (debeDisparar(NOTAS, s, texto, estado)) {
        estado = trasDisparar(s, texto, estado)
        disparos++
      }
    }
    expect(disparos).toBe(0)
  })
})
