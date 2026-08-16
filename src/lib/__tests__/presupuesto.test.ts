import { afterEach, describe, expect, it, vi } from "vitest"

import {
  evaluar,
  inicioDelMesBogota,
  inicioDelMesISO,
  mensajeSinCupo,
  proximoReinicio,
  topeConfigurado,
  TOPE_DE_SEGURIDAD,
} from "@/lib/athos-agent/presupuesto"

afterEach(() => vi.unstubAllEnvs())

describe("topeConfigurado", () => {
  // CAMBIÓ EL CONTRATO el 2026-08-16. Antes, sin la variable no había NINGÚN tope — y la variable no
  // estaba puesta en Vercel, verificado mirando el riel en producción (el medidor de cupo no se
  // pintaba). O sea que el gasto de IA no tenía techo, y el único freno era `rateLimit`, que es en
  // memoria y por lambda. Un techo que depende de que alguien lo configure no es un techo.
  it("sin la variable cae en el tope de contención, no en 'sin tope'", () => {
    expect(topeConfigurado(undefined)).toBe(TOPE_DE_SEGURIDAD)
    expect(topeConfigurado("")).toBe(TOPE_DE_SEGURIDAD)
    expect(topeConfigurado("   ")).toBe(TOPE_DE_SEGURIDAD)
  })

  // El escape sin desplegar código: si el techo de contención llegara a cortarle a alguien de
  // verdad, se apaga con una variable y no con un release.
  it("'ninguno' apaga el tope, y es una decisión explícita", () => {
    expect(topeConfigurado("ninguno")).toBeNull()
    expect(topeConfigurado("NINGUNO")).toBeNull()
    expect(topeConfigurado("  ninguno  ")).toBeNull()
  })

  // 1000 es ~26× la clínica más intensa medida en el principal (38 llamadas en agosto de 2026). No
  // es un plan ni un precio: es el punto donde esto dejó de ser uso y es un bucle.
  it("el tope de contención no toca a nadie en uso normal", () => {
    expect(TOPE_DE_SEGURIDAD).toBeGreaterThanOrEqual(500)
  })

  it("un valor válido se toma tal cual", () => {
    expect(topeConfigurado("500")).toBe(500)
    expect(topeConfigurado("0")).toBe(0) // tope 0 explícito: Athos apagado para todos, a propósito
  })

  it("un valor inválido cae en el tope de contención, no en 'sin tope'", () => {
    // Un typo sigue sin poder dejar a la plataforma sin Athos: no cae en "tope de cero". Pero ahora
    // tampoco cae en "sin techo" — ante algo que no se entiende, contener es más seguro que abrir.
    for (const malo of ["quinientos", "-3", "12.5", "500x", "NaN"]) {
      expect(topeConfigurado(malo)).toBe(TOPE_DE_SEGURIDAD)
    }
  })

  it("tolera lo que es un número sin ambigüedad, aunque no esté escrito bonito", () => {
    // Espacios de sobra al copiar la variable, o notación científica. No hay nada que interpretar
    // mal acá, y rechazarlo apagaría un tope que alguien creyó haber puesto.
    expect(topeConfigurado(" 500 ")).toBe(500)
    expect(topeConfigurado("1e3")).toBe(1000)
  })

  it("lee de process.env cuando no se le pasa nada", () => {
    vi.stubEnv("ATHOS_TOPE_MENSUAL_POR_CLINICA", "42")
    expect(topeConfigurado()).toBe(42)
  })
})

describe("el período va por el calendario de Bogotá, no por UTC", () => {
  it("el 31 a las 20:00 de Bogotá TODAVÍA es el mes viejo", () => {
    // En UTC ya es el 1º a las 01:00. Con la fecha de UTC, el contador se reiniciaría cinco horas
    // antes de que termine el mes de la clínica — regalando un pedazo de mes cada 30 días.
    const finDeAgostoEnBogota = new Date("2026-09-01T01:00:00Z")
    expect(inicioDelMesBogota(finDeAgostoEnBogota)).toBe("2026-08-01")
    expect(proximoReinicio(finDeAgostoEnBogota)).toBe("2026-09-01")
  })

  it("pasadas las 05:00 UTC del 1º sí arrancó el mes nuevo", () => {
    const primeroDeSeptiembre = new Date("2026-09-01T05:30:00Z")
    expect(inicioDelMesBogota(primeroDeSeptiembre)).toBe("2026-09-01")
    expect(proximoReinicio(primeroDeSeptiembre)).toBe("2026-10-01")
  })

  it("el instante de arranque es medianoche de Bogotá, o sea las 05:00Z", () => {
    expect(inicioDelMesISO(new Date("2026-08-15T12:00:00Z"))).toBe("2026-08-01T05:00:00.000Z")
  })

  it("diciembre rueda al año siguiente", () => {
    expect(proximoReinicio(new Date("2026-12-20T12:00:00Z"))).toBe("2027-01-01")
  })
})

describe("evaluar", () => {
  const AHORA = new Date("2026-08-15T12:00:00Z")

  it("sin tope siempre deja pasar, y no inventa un número de restantes", () => {
    const p = evaluar(9999, null, AHORA)
    expect(p.permitido).toBe(true)
    expect(p.tope).toBeNull()
    expect(p.restantes).toBeNull()
  })

  it("por debajo del tope deja pasar y dice cuántas quedan", () => {
    const p = evaluar(120, 500, AHORA)
    expect(p.permitido).toBe(true)
    expect(p.restantes).toBe(380)
  })

  it("EN el tope ya no deja pasar: el número es el techo, no el último permitido", () => {
    const p = evaluar(500, 500, AHORA)
    expect(p.permitido).toBe(false)
    expect(p.restantes).toBe(0)
  })

  it("pasado el tope no reporta restantes negativas", () => {
    // La cuenta va un turno atrás, así que pasarse por unas pocas es esperable. "-7 restantes" en
    // pantalla no es información.
    expect(evaluar(507, 500, AHORA).restantes).toBe(0)
  })

  it("un tope de 0 bloquea desde la primera llamada", () => {
    expect(evaluar(0, 0, AHORA).permitido).toBe(false)
  })
})

describe("mensajeSinCupo", () => {
  it("dice cuánto era el tope y cuándo vuelve el cupo", () => {
    const texto = mensajeSinCupo(evaluar(500, 500, new Date("2026-08-15T12:00:00Z")))
    expect(texto).toContain("500")
    expect(texto).toContain("2026-09-01")
  })

  it("NO promete un plan que todavía no existe", () => {
    // No hay pasarela ni planes (Wompi está sin integrar). Mandar al vet a "actualizar tu plan" lo
    // deja buscando un botón que no está en ninguna pantalla.
    const texto = mensajeSinCupo(evaluar(500, 500, new Date("2026-08-15T12:00:00Z")))
    expect(texto.toLowerCase()).not.toMatch(/actualiz|upgrade|plan superior|suscrib/)
  })

  it("aclara que el resto de la app sigue andando", () => {
    // El acta es explícita: el CRM es gratis de por vida. Quedarse sin cupo de IA no puede leerse
    // como que se cayó Tuvetia.
    expect(mensajeSinCupo(evaluar(500, 500, new Date()))).toMatch(/sigue funcionando/i)
  })
})
