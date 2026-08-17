import { describe, expect, it } from "vitest"

import {
  INCLUYE_FREE,
  INCLUYE_PRO,
  MENSAJE_REQUIERE_PRO,
  PLAN_MINIMO,
  comoEstado,
  comoPlan,
  seRenueva,
  tieneAcceso,
  type Capacidad,
} from "@/lib/planes"

const TODAS = Object.keys(PLAN_MINIMO) as Capacidad[]

describe("comoPlan", () => {
  it("sólo 'pro' es pro — todo lo demás cae a free", () => {
    expect(comoPlan("pro")).toBe("pro")
    expect(comoPlan("free")).toBe("free")
  })

  it("ANTE LA DUDA, NIEGA", () => {
    // La dirección importa más que el caso: un plan ilegible tiene que negar. Al revés, un typo en
    // la columna —o un embed que la RLS devolvió en null— regalaría el producto entero.
    expect(comoPlan(null)).toBe("free")
    expect(comoPlan(undefined)).toBe("free")
    expect(comoPlan("Pro")).toBe("free")
    expect(comoPlan("PRO")).toBe("free")
    expect(comoPlan("premium")).toBe("free")
    expect(comoPlan(1)).toBe("free")
    expect(comoPlan({})).toBe("free")
  })
})

describe("tieneAcceso", () => {
  it("free NO llega a ninguna superficie de IA", () => {
    // Es el corte entero del producto en una línea. Si alguna capacidad se escapa de esta lista,
    // una clínica gratis gasta plata nuestra.
    for (const c of TODAS) {
      expect(tieneAcceso("free", c), `free no debería poder usar ${c}`).toBe(false)
    }
  })

  it("pro llega a todas", () => {
    for (const c of TODAS) {
      expect(tieneAcceso("pro", c), `pro debería poder usar ${c}`).toBe(true)
    }
  })

  it("LAS SUPERFICIES QUE GASTAN SIN QUE NADIE MIRE están cubiertas", () => {
    // Este test existe por el agujero que el corte "por pantalla" dejaba abierto: si el gate fuera
    // sólo Athos y Modo Fantasma, una clínica free seguiría quemando IA por el modo automático de
    // WhatsApp, por cartera y por el briefing — las tres corren sin sesión y sin nadie delante.
    expect(PLAN_MINIMO["whatsapp-automatico"]).toBe("pro")
    expect(PLAN_MINIMO["cartera-ia"]).toBe("pro")
    expect(PLAN_MINIMO.briefing).toBe("pro")
    expect(PLAN_MINIMO["sugerencia-whatsapp"]).toBe("pro")
    expect(PLAN_MINIMO["receta-por-foto"]).toBe("pro")
  })
})

describe("mensajes y listas", () => {
  it("toda capacidad tiene su mensaje — ninguna cae en un texto vacío", () => {
    for (const c of TODAS) {
      expect(MENSAJE_REQUIERE_PRO[c], `falta el mensaje de ${c}`).toBeTruthy()
    }
  })

  it("las listas de la pantalla de precios no están vacías ni repiten iconos sin texto", () => {
    expect(INCLUYE_FREE.length).toBeGreaterThan(0)
    expect(INCLUYE_PRO.length).toBeGreaterThan(0)
    for (const b of [...INCLUYE_FREE, ...INCLUYE_PRO]) {
      expect(b.texto.trim()).toBeTruthy()
      expect(b.icono.trim()).toBeTruthy()
    }
  })

  it("la lista de Pro cubre las capacidades que se cobran", () => {
    // No es una comparación uno a uno —los textos son comerciales, no técnicos— pero sí tiene que
    // haber al menos tantos bullets como capacidades: una pantalla de precios que prometa menos de
    // lo que se cobra deja al vet sin saber por qué paga.
    expect(INCLUYE_PRO.length).toBeGreaterThanOrEqual(TODAS.length)
  })
})

describe("comoEstado y seRenueva", () => {
  it("normaliza los estados conocidos", () => {
    for (const e of ["cortesia", "inactive", "active", "past_due", "canceled"]) {
      expect(comoEstado(e)).toBe(e)
    }
  })

  it("lo desconocido cae a 'trial', que es el default histórico de la columna", () => {
    expect(comoEstado("cualquier_cosa")).toBe("trial")
    expect(comoEstado(null)).toBe("trial")
    expect(comoEstado(42)).toBe("trial")
  })

  it("sólo active y past_due se vuelven a cobrar", () => {
    expect(seRenueva("active")).toBe(true)
    // En mora SIGUE renovando: está en período de gracia y se reintenta.
    expect(seRenueva("past_due")).toBe(true)

    // Cortesía es Pro REGALADO: no hay tarjeta y no se cobra. Si esto devolviera true, el barrido
    // intentaría cobrarle a clínicas sin medio de pago todos los días.
    expect(seRenueva("cortesia")).toBe(false)
    expect(seRenueva("canceled")).toBe(false)
    expect(seRenueva("inactive")).toBe(false)
    expect(seRenueva("trial")).toBe(false)
  })
})
