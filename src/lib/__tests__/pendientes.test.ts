// Las señales de "qué está esperando en la clínica". Lógica pura: sin base, sin React y sin IA.
import { describe, expect, it } from "vitest"

import {
  canalCaido,
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

describe("el canal que se murió", () => {
  // EL CASO REAL, medido contra el principal el 2026-08-16: las dos integraciones llevaban 5 y 6
  // días en `disconnected`, con el tráfico cayendo de ~370 mensajes diarios a cero de un día para
  // el otro, y NADA se lo dijo a nadie. El estado se escribía con el comentario "(aviso en
  // Configuración)" — o sea, visible sólo para quien entrara a esa pantalla.
  it("una integración desconectada es una señal", () => {
    const p = canalCaido([{ status: "disconnected", updated_at: "2026-08-11T14:00:00Z" }], HOY)
    expect(p?.id).toBe("canal-caido")
    expect(p?.etiqueta).toBe("WhatsApp desconectado")
  })

  it("conectada no es señal", () => {
    expect(canalCaido([{ status: "connected", updated_at: "2026-08-11T14:00:00Z" }], HOY)).toBeNull()
  })

  // LA DISTINCIÓN QUE MÁS IMPORTA. `pending` es una conexión que se empezó y no se terminó (se
  // mostró el QR y nadie lo escaneó): eso es configuración a medias y ya lo cubre el riel con el
  // paso "WhatsApp conectado". Llamarle "caído" manda a buscar una avería que no existe, y repetir
  // el mismo pendiente en dos superficies es cómo un tablero empieza a ignorarse.
  it("pending NO es un canal caído: nunca estuvo en pie", () => {
    expect(canalCaido([{ status: "pending", updated_at: "2026-08-11T14:00:00Z" }], HOY)).toBeNull()
  })

  it("sin integraciones no hay nada que reportar", () => {
    expect(canalCaido([], HOY)).toBeNull()
  })

  // Si algo entrega mensajes, el canal vive — aunque otra integración esté caída.
  it("con una conectada y otra caída, no hay señal", () => {
    const p = canalCaido(
      [
        { status: "disconnected", updated_at: "2026-08-11T14:00:00Z" },
        { status: "connected", updated_at: "2026-08-15T14:00:00Z" },
      ],
      HOY,
    )
    expect(p).toBeNull()
  })

  describe("cuánto lleva caído — es lo que lo hace accionable", () => {
    it("hace varios días lo dice con el número", () => {
      const p = canalCaido([{ status: "disconnected", updated_at: "2026-08-11T14:00:00Z" }], HOY)
      expect(p?.detalle).toBe("Hace 5 días · sin mensajes")
    })

    it("ayer se dice ayer", () => {
      const p = canalCaido([{ status: "disconnected", updated_at: "2026-08-15T14:00:00Z" }], HOY)
      expect(p?.detalle).toBe("Desde ayer · sin mensajes")
    })

    it("hoy se dice hoy", () => {
      const p = canalCaido([{ status: "disconnected", updated_at: "2026-08-16T14:00:00Z" }], HOY)
      expect(p?.detalle).toBe("Desde hoy · sin mensajes")
    })

    // Sin fecha se dice lo que se sabe y nada más: inventar "hace 0 días" sería peor que omitirlo.
    it("sin fecha, la señal sigue apareciendo pero sin contar días", () => {
      const p = canalCaido([{ status: "disconnected", updated_at: null }], HOY)
      expect(p?.detalle).toBe("Sin mensajes hasta reconectar")
    })

    it("una fecha ilegible no rompe la pantalla de inicio", () => {
      const p = canalCaido([{ status: "disconnected", updated_at: "no es una fecha" }], HOY)
      expect(p?.detalle).toBe("Sin mensajes hasta reconectar")
    })

    // Un reloj adelantado no puede producir "hace -1 días".
    it("una caída en el futuro se trata como hoy", () => {
      const p = canalCaido([{ status: "disconnected", updated_at: "2026-08-20T14:00:00Z" }], HOY)
      expect(p?.detalle).toBe("Desde hoy · sin mensajes")
    })

    it("con varias caídas manda la más reciente", () => {
      const p = canalCaido(
        [
          { status: "disconnected", updated_at: "2026-08-01T14:00:00Z" },
          { status: "disconnected", updated_at: "2026-08-15T14:00:00Z" },
        ],
        HOY,
      )
      expect(p?.detalle).toBe("Desde ayer · sin mensajes")
    })
  })
})

describe("todo junto, y en qué orden", () => {
  // EL CRITERIO: primero lo que tiene a una PERSONA DE AFUERA esperando. Un titular que escribió
  // espera ahora; una nota sin firmar es trabajo del vet consigo mismo; una vacuna que vence en tres
  // semanas no es de hoy.
  //
  // `canal-caido` rompe ese criterio a propósito y va antes que todo: no es una tarea, es una
  // PRECONDICIÓN. Mandar a responder tres conversaciones por un canal muerto es mandar a hacer algo
  // que no se puede hacer.
  it("el canal caído va antes que todo, y después lo que tiene gente esperando", () => {
    const ps = pendientesDeLaClinica({
      hoyISO: HOY,
      notas: [{ status: "draft" }],
      mensajes: [{ owner_id: "o1", direction: "inbound", created_at: "2026-08-15T10:00:00Z" }],
      vacunas: [{ next_dose_at: "2026-08-20" }],
      tareas: [{ status: "open" }],
      cobros: { cuantas: 1, totalCents: 50_000 },
      integraciones: [{ status: "disconnected", updated_at: "2026-08-11T14:00:00Z" }],
    })
    expect(ps.map((p) => p.id)).toEqual([
      "canal-caido",
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
