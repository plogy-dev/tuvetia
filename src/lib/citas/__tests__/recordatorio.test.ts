/**
 * El recordatorio de cita.
 *
 * ── LO QUE SE PROTEGE ─────────────────────────────────────────────────────────────────────────
 *
 * Tres cosas, y las tres se rompen sin hacer ruido:
 *
 *   1. QUÉ DÍA se avisa. Un error acá manda el aviso el día equivocado — o el día de la cita, que
 *      es peor que no mandarlo.
 *   2. QUE EL MENSAJE DIGA CUÁNDO. Sin `{fecha}` y `{hora}`, «tiene una cita» sale igual y no le
 *      sirve a nadie; el envío queda en ENVIADO y nadie se entera hasta que un titular no aparece.
 *   3. QUE SALGA UNA SOLA VEZ. El cron se reintenta. Repetir un aviso molesta siempre, y en el otro
 *      régimen —cobranza— es justo lo que la Ley 2300 vino a frenar.
 */
import { describe, expect, it } from "vitest"

import {
  ESTADOS_QUE_SE_AVISAN,
  TEXTO_POR_DEFECTO,
  diaAAvisar,
  diasDeAnticipacion,
  fechaYHora,
  llenarTexto,
  revisarTexto,
} from "@/lib/citas/recordatorio"

/** 25 de agosto de 2026, 9:00 en Bogotá (14:00 UTC) — la hora a la que corre el barrido. */
const BARRIDO = new Date("2026-08-25T14:00:00Z")

describe("qué día se avisa", () => {
  it("24 horas = el día siguiente", () => {
    expect(diaAAvisar(24, BARRIDO)).toBe("2026-08-26")
  })

  it("48 y 72 horas corren el día como corresponde", () => {
    expect(diaAAvisar(48, BARRIDO)).toBe("2026-08-27")
    expect(diaAAvisar(72, BARRIDO)).toBe("2026-08-28")
  })

  it("NUNCA avisa el mismo día", () => {
    // Con un barrido de las 9 a. m., «hoy» significaría avisar de una cita de las 9:30 media hora
    // antes — y de una de las 8 a. m., DESPUÉS de que pasó.
    for (const horas of [1, 6, 12, 23]) {
      expect(diasDeAnticipacion(horas), `${horas} h`).toBe(1)
      expect(diaAAvisar(horas, BARRIDO)).toBe("2026-08-26")
    }
  })

  it("aguanta basura sin devolver un día inválido", () => {
    for (const malo of [0, -5, NaN, Infinity]) {
      expect(diasDeAnticipacion(malo), `${malo}`).toBe(1)
    }
  })

  it("CRUZA EL FIN DE MES sin inventar un 32", () => {
    // Sumar días a mano es donde esto se rompe. Se calcula sobre la fecha civil, no sumando
    // milisegundos a un instante.
    const ultimoDeAgosto = new Date("2026-08-31T14:00:00Z")
    expect(diaAAvisar(24, ultimoDeAgosto)).toBe("2026-09-01")
    const ultimoDelAnio = new Date("2026-12-31T14:00:00Z")
    expect(diaAAvisar(24, ultimoDelAnio)).toBe("2027-01-01")
  })

  it("usa el día de BOGOTÁ, no el de UTC", () => {
    // A las 21:00 de Bogotá ya es el día siguiente en UTC. Si se tomara el día UTC, el barrido de
    // una corrida tardía saltaría un día entero de citas.
    const nocheEnBogota = new Date("2026-08-25T02:30:00Z") // 21:30 del 24 en Bogotá
    expect(diaAAvisar(24, nocheEnBogota)).toBe("2026-08-25")
  })
})

describe("el texto", () => {
  it("el de por defecto pasa su propia revisión", () => {
    expect(revisarTexto(TEXTO_POR_DEFECTO)).toBeNull()
  })

  it("EXIGE {fecha} Y {hora}", () => {
    const problema = revisarTexto("Le recordamos su cita en {clinica}.")
    expect(problema).toContain("{fecha}")
    expect(problema).toContain("{hora}")
    expect(problema).toContain("no sabe cuándo")
  })

  it("no exige {paciente} ni {clinica}", () => {
    // Hay clínicas de un solo vet donde el titular sabe perfectamente de quién le hablan.
    expect(revisarTexto("Su cita es el {fecha} a las {hora}.")).toBeNull()
  })

  it("rechaza un hueco que no existe, y lo nombra", () => {
    const problema = revisarTexto("Hola {nombre}, su cita: {fecha} {hora}")
    expect(problema).toContain("{nombre}")
    expect(problema).toContain("tal cual")
  })

  it("rechaza vacío y lo que se pasa de largo", () => {
    expect(revisarTexto("   ")).toContain("vacío")
    expect(revisarTexto(`{fecha} {hora} ${"a".repeat(700)}`)).toContain("caracteres")
  })
})

describe("llenarTexto", () => {
  const VALORES = {
    paciente: "Milo",
    fecha: "martes, 26 de agosto",
    hora: "10:30 a. m.",
    clinica: "Veterinaria Selva",
  }

  it("llena los cuatro huecos", () => {
    expect(llenarTexto("{paciente} · {fecha} · {hora} · {clinica}", VALORES)).toBe(
      "Milo · martes, 26 de agosto · 10:30 a. m. · Veterinaria Selva",
    )
  })

  it("reemplaza TODAS las apariciones, no la primera", () => {
    // La lección que dejaron las plantillas de cobranza el 24-ago.
    const salida = llenarTexto("{hora}, repito: {hora}", VALORES)
    expect(salida).not.toContain("{hora}")
    expect(salida.match(/10:30/g)).toHaveLength(2)
  })

  it("no interpreta `$&` del valor como referencia de reemplazo", () => {
    expect(llenarTexto("{clinica}", { ...VALORES, clinica: "$& $1" })).toBe("$& $1")
  })
})

describe("fechaYHora", () => {
  it("escribe la fecha y la hora en hora de Bogotá", () => {
    // 2026-08-26T15:30:00Z = 10:30 a. m. en Bogotá.
    const { fecha, hora } = fechaYHora("2026-08-26T15:30:00Z")
    expect(fecha).toContain("26")
    expect(fecha.toLowerCase()).toContain("agosto")
    expect(hora).toContain("10:30")
  })
})

describe("a qué citas se les avisa", () => {
  it("sólo a las que siguen en pie", () => {
    // Es lista blanca: un estado nuevo no entra solo. Avisar de una cita cancelada es peor que no
    // avisar — el titular se presenta.
    expect(ESTADOS_QUE_SE_AVISAN).toEqual(["scheduled", "confirmed"])
    expect(ESTADOS_QUE_SE_AVISAN as readonly string[]).not.toContain("canceled")
  })
})
