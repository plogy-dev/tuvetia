// Las señales de "qué está esperando en la clínica". Lógica pura: sin base, sin React y sin IA.
import { describe, expect, it } from "vitest"

import {
  cobrosVencidos,
  conversacionesSinResponder,
  notasSinAprobar,
  pendientesDeLaClinica,
  pendientesParaElPrompt,
  tareasEsperandoAUnaPersona,
  vacunasPorVencer,
} from "@/lib/senales/pendientes"

const HOY = "2026-08-16"

describe("notas sin aprobar", () => {
  // Medido contra el principal el 2026-08-16: 18 notas en borrador. No es teórico.
  it("cuenta sólo los borradores", () => {
    const p = notasSinAprobar([{ status: "draft" }, { status: "approved" }, { status: "draft" }])
    expect(p?.etiqueta).toBe("2 notas sin aprobar")
  })

  it("una sola se dice en singular", () => {
    expect(notasSinAprobar([{ status: "draft" }])?.etiqueta).toBe("1 nota sin aprobar")
  })

  it("sin borradores no hay pendiente", () => {
    expect(notasSinAprobar([{ status: "approved" }])).toBeNull()
    expect(notasSinAprobar([])).toBeNull()
  })

  // El detalle explica POR QUÉ importa: una nota sin firmar no está en la historia clínica.
  it("dice qué se pierde si no se firman", () => {
    expect(notasSinAprobar([{ status: "draft" }])?.detalle).toMatch(/historia cl[ií]nica/i)
  })
})

describe("conversaciones sin responder", () => {
  const msg = (owner: string | null, direction: string, created_at: string) => ({
    owner_id: owner,
    direction,
    created_at,
  })

  it("un titular cuyo último mensaje es entrante está esperando", () => {
    const p = conversacionesSinResponder([
      msg("o1", "outbound", "2026-08-15T10:00:00Z"),
      msg("o1", "inbound", "2026-08-15T11:00:00Z"),
    ])
    expect(p?.etiqueta).toBe("1 titular sin respuesta")
  })

  it("si ya se le contestó, no está esperando", () => {
    const p = conversacionesSinResponder([
      msg("o1", "inbound", "2026-08-15T10:00:00Z"),
      msg("o1", "outbound", "2026-08-15T11:00:00Z"),
    ])
    expect(p).toBeNull()
  })

  // Tres mensajes seguidos del mismo dueño son UNA conversación esperando, no tres.
  it("cuenta titulares, no mensajes", () => {
    const p = conversacionesSinResponder([
      msg("o1", "inbound", "2026-08-15T10:00:00Z"),
      msg("o1", "inbound", "2026-08-15T11:00:00Z"),
      msg("o1", "inbound", "2026-08-15T12:00:00Z"),
    ])
    expect(p?.etiqueta).toBe("1 titular sin respuesta")
  })

  it("varios titulares esperando se cuentan aparte", () => {
    const p = conversacionesSinResponder([
      msg("o1", "inbound", "2026-08-15T10:00:00Z"),
      msg("o2", "inbound", "2026-08-14T10:00:00Z"),
      msg("o3", "outbound", "2026-08-15T10:00:00Z"),
    ])
    expect(p?.etiqueta).toBe("2 titulares sin respuesta")
  })

  // El que lleva más tiempo esperando es el que hay que atender primero.
  it("el detalle nombra al más antiguo", () => {
    const p = conversacionesSinResponder([
      msg("o1", "inbound", "2026-08-15T10:00:00Z"),
      msg("o2", "inbound", "2026-08-11T10:00:00Z"),
    ])
    expect(p?.detalle).toContain("2026-08-11")
  })

  // No se puede decir a quién responderle, así que no se cuenta como pendiente accionable.
  it("los mensajes sin titular se ignoran", () => {
    expect(conversacionesSinResponder([msg(null, "inbound", "2026-08-15T10:00:00Z")])).toBeNull()
  })
})

describe("vacunas", () => {
  it("cuenta las vencidas y las próximas juntas", () => {
    const p = vacunasPorVencer(
      [{ next_dose_at: "2026-08-10" }, { next_dose_at: "2026-08-30" }],
      HOY,
    )
    expect(p?.etiqueta).toBe("2 refuerzos por vencer")
  })

  // Vencido y por vencer son DOS acciones distintas —llamar hoy vs. agendar— y un solo número que
  // las mezcle no le sirve a nadie.
  it("el detalle separa las que ya vencieron", () => {
    const p = vacunasPorVencer([{ next_dose_at: "2026-08-10" }, { next_dose_at: "2026-08-30" }], HOY)
    expect(p?.detalle).toBe("1 ya vencidos")
  })

  it("sin vencidas el detalle habla del horizonte", () => {
    expect(vacunasPorVencer([{ next_dose_at: "2026-08-30" }], HOY)?.detalle).toMatch(/30 días/)
  })

  it("lo que cae fuera de la ventana no cuenta", () => {
    expect(vacunasPorVencer([{ next_dose_at: "2027-01-01" }], HOY)).toBeNull()
  })

  it("una vacuna sin próxima dosis no es un pendiente", () => {
    expect(vacunasPorVencer([{ next_dose_at: null }], HOY)).toBeNull()
  })
})

describe("cobros y tareas", () => {
  it("el monto va con puntos de miles, como se escribe en Colombia", () => {
    expect(cobrosVencidos(2, 123_456_700)?.detalle).toBe("$ 1.234.567")
  })

  it("sin cobros vencidos no hay pendiente", () => {
    expect(cobrosVencidos(0, 0)).toBeNull()
  })

  it("las tareas cuentan sólo las abiertas", () => {
    const p = tareasEsperandoAUnaPersona([{ status: "open" }, { status: "done" }])
    expect(p?.etiqueta).toBe("1 caso de cobranza para revisar")
  })
})

describe("todo junto, y en qué orden", () => {
  // EL CRITERIO: primero lo que tiene a una PERSONA DE AFUERA esperando. Un titular que escribió
  // espera ahora; una nota sin firmar es trabajo del vet consigo mismo; una vacuna que vence en tres
  // semanas no es de hoy.
  it("lo que tiene gente esperando va primero", () => {
    const ps = pendientesDeLaClinica({
      hoyISO: HOY,
      notas: [{ status: "draft" }],
      mensajes: [{ owner_id: "o1", direction: "inbound", created_at: "2026-08-15T10:00:00Z" }],
      vacunas: [{ next_dose_at: "2026-08-20" }],
      tareas: [{ status: "open" }],
      cobros: { cuantas: 1, totalCents: 50_000 },
    })
    expect(ps.map((p) => p.id)).toEqual([
      "conversaciones",
      "tareas-cartera",
      "notas-sin-aprobar",
      "cobros-vencidos",
      "vacunas",
    ])
  })

  it("las que no aplican no ocupan lugar", () => {
    const ps = pendientesDeLaClinica({ hoyISO: HOY, notas: [{ status: "draft" }] })
    expect(ps).toHaveLength(1)
    expect(ps[0].id).toBe("notas-sin-aprobar")
  })

  // "Nada pendiente" no se anuncia: se nota.
  it("una clínica al día devuelve lista vacía", () => {
    expect(pendientesDeLaClinica({ hoyISO: HOY, notas: [], mensajes: [], vacunas: [] })).toEqual([])
  })

  it("sin insumos no revienta", () => {
    expect(pendientesDeLaClinica({ hoyISO: HOY })).toEqual([])
  })
})

describe("las señales entran al prompt", () => {
  it("se listan con su detalle", () => {
    const t = pendientesParaElPrompt([
      { id: "notas-sin-aprobar", etiqueta: "3 notas sin aprobar", detalle: "No entran a la historia" },
    ])
    expect(t).toContain("3 notas sin aprobar")
    expect(t).toContain("No entran a la historia")
  })

  // Sin esto el modelo saldría a buscar con herramientas algo que ya tiene en el prompt.
  it("le dice al modelo que ya lo sabe, para que no lo busque", () => {
    const t = pendientesParaElPrompt([{ id: "x", etiqueta: "1 cosa", detalle: "d" }])
    expect(t).toMatch(/no hace falta que busques|ya lo sab/i)
  })

  // Una línea que diga "no hay nada pendiente" se paga en tokens todos los turnos.
  it("sin pendientes no agrega línea", () => {
    expect(pendientesParaElPrompt([])).toBeNull()
  })
})
