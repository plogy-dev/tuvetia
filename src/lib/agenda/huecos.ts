// Los huecos del día: bloques CONTIGUOS libres dentro del horario de atención.
//
// No es lo mismo que `athos-agent/agenda.ts:calcularCupos`, y por eso vive aparte. Aquélla devuelve
// CUPOS —posiciones donde cabe una cita de X minutos, cada `slot_minutes`— y sirve para ofrecerle
// opciones a un titular por WhatsApp. Ésta devuelve HUECOS: "de 15:20 a 16:00, 40 minutos libres".
//
// La diferencia importa porque el mockup muestra el hueco como una FILA DE LA AGENDA con su
// duración, junto a las citas. Con cupos habría que pintar "15:20, 15:50" como dos líneas sueltas y
// se perdería justo el dato que hace accionable la fila: cuánto tiempo hay seguido.
//
// Puro y sin red: `vitest.config.mts` corre en `environment: "node"` sobre `src/**/*.test.ts`, así
// que lo que quiera cobertura tiene que ser un `.ts` sin componentes. Mismo criterio que
// `lib/consulta-viva/sesion.ts` y `lib/onboarding/progreso.ts`.

/** Bogotá. Igual que en `athos-agent/agenda.ts` — la clínica opera en una sola zona. */
const TZ_OFFSET = "-05:00"
const TZ_OFFSET_MINUTES = -300

export type FranjaDeAtencion = {
  /** "HH:mm" o "HH:mm:ss". */
  opens_at: string
  closes_at: string
}

export type Ocupado = {
  /** ISO con zona. */
  starts_at: string
  ends_at: string
}

export type Hueco = {
  /** Hora local "HH:mm". */
  desde: string
  hasta: string
  minutos: number
}

function aMs(date: string, hhmm: string): number {
  return new Date(`${date}T${hhmm.slice(0, 5)}:00${TZ_OFFSET}`).getTime()
}

function aHoraLocal(ms: number): string {
  const d = new Date(ms + TZ_OFFSET_MINUTES * 60_000)
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`
}

/**
 * Bloques libres de al menos `minimoMinutos`, dentro de las franjas de atención del día.
 *
 * Las citas se FUSIONAN antes de restar: dos que se solapan o se tocan son un solo bloque ocupado.
 * Sin eso, dos citas pegadas (10:00–10:30 y 10:30–11:00) dejarían un "hueco" de cero minutos entre
 * ellas, y una que empieza dentro de otra partiría el día en pedazos que no existen.
 */
export function huecosDelDia({
  date,
  franjas,
  ocupados,
  minimoMinutos = 30,
}: {
  date: string
  franjas: FranjaDeAtencion[]
  ocupados: Ocupado[]
  minimoMinutos?: number
}): Hueco[] {
  const ocupado = ocupados
    .map((o) => ({ from: new Date(o.starts_at).getTime(), to: new Date(o.ends_at).getTime() }))
    .filter((o) => Number.isFinite(o.from) && Number.isFinite(o.to) && o.to > o.from)
    .sort((a, b) => a.from - b.from)

  const fusionados: { from: number; to: number }[] = []
  for (const o of ocupado) {
    const ultimo = fusionados[fusionados.length - 1]
    if (ultimo && o.from <= ultimo.to) {
      ultimo.to = Math.max(ultimo.to, o.to)
    } else {
      fusionados.push({ ...o })
    }
  }

  const huecos: Hueco[] = []
  for (const f of franjas) {
    const abre = aMs(date, f.opens_at)
    const cierra = aMs(date, f.closes_at)
    if (!Number.isFinite(abre) || !Number.isFinite(cierra) || cierra <= abre) continue

    let cursor = abre
    for (const o of fusionados) {
      // Sólo interesa lo que cae DENTRO de esta franja: una cita de la tarde no parte la mañana.
      if (o.to <= cursor) continue
      if (o.from >= cierra) break
      if (o.from > cursor) {
        const minutos = Math.round((Math.min(o.from, cierra) - cursor) / 60_000)
        if (minutos >= minimoMinutos) {
          huecos.push({ desde: aHoraLocal(cursor), hasta: aHoraLocal(Math.min(o.from, cierra)), minutos })
        }
      }
      cursor = Math.max(cursor, o.to)
    }
    if (cursor < cierra) {
      const minutos = Math.round((cierra - cursor) / 60_000)
      if (minutos >= minimoMinutos) {
        huecos.push({ desde: aHoraLocal(cursor), hasta: aHoraLocal(cierra), minutos })
      }
    }
  }

  return huecos.sort((a, b) => a.desde.localeCompare(b.desde))
}
