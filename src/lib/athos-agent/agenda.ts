/**
 * Hora local de la clínica y cálculo de cupos. Vive aparte porque lo usan DOS juegos de tools con
 * clientes de base distintos: las del vet (`tools.ts`, con RLS) y las del modo auto de WhatsApp
 * (`auto-tools.ts`, con service_role y `clinic_id` explícito).
 *
 * Duplicar el cálculo garantizaba que en unos meses dieran horarios distintos — y que el titular
 * viera por WhatsApp un cupo que el vet no ve en su agenda.
 *
 * Colombia no tiene horario de verano, así que el offset es fijo. Las dos constantes de abajo son la
 * MISMA información en dos formatos y tienen que moverse juntas si algún día se soporta otra zona.
 */
export const TZ_OFFSET = "-05:00"
export const TZ_OFFSET_MINUTES = -300

export function localToIso(date: string, time: string): string {
  return `${date}T${time}:00${TZ_OFFSET}`
}

/**
 * Rango [from, to) en ISO a partir de fecha + hora LOCAL. Devuelve null si el instante no existe.
 *
 * Por qué la guarda: los regex de los inputSchema validan FORMATO, no calendario. `2026-02-30` y
 * `99:99` pasan `/^\d{4}-\d{2}-\d{2}$/` y `/^\d{2}:\d{2}$/` sin problema, y revientan en `new Date()`
 * como Invalid Date. Los modelos producen ese tipo de fecha con más frecuencia de la que uno espera
 * (febrero 30, mes 13). La versión anterior hacía `new Date(NaN).toISOString()` y lanzaba
 * `RangeError: Invalid time value`: el turno del agente se caía entero, sin mensaje útil.
 *
 * `minutes` no finito se trata como 0 en vez de propagar NaN: el schema tiene default, pero esto no
 * debería depender de que alguien lo haya aplicado.
 */
export function localRange(
  date: string,
  time: string,
  minutes: number,
): { from: string; to: string } | null {
  const from = localToIso(date, time)
  const fromMs = new Date(from).getTime()
  if (!Number.isFinite(fromMs)) return null // mes 13, hora 99:99…

  // ROUND-TRIP, y es lo que de verdad importa: `2026-02-30` NO es Invalid Date. JavaScript la
  // RUEDA en silencio a 2026-03-02, igual que `2026-02-29` (2026 no es bisiesto) → 2026-03-01.
  // Sin esta comprobación la cita se agendaba OTRO DÍA sin que nadie se enterara — corrupción
  // silenciosa, peor que un error. Se reconstruye la fecha local y se exige que sea la pedida.
  const localMs = fromMs + TZ_OFFSET_MINUTES * 60_000
  const back = new Date(localMs)
  const ymd = `${back.getUTCFullYear()}-${String(back.getUTCMonth() + 1).padStart(2, "0")}-${String(back.getUTCDate()).padStart(2, "0")}`
  if (ymd !== date) return null

  const mins = Number.isFinite(minutes) ? minutes : 0
  return { from, to: new Date(fromMs + mins * 60_000).toISOString() }
}

/** Mensaje único cuando la fecha no existe (no se repite el texto en cada tool). */
export function invalidDateError(date: string, time?: string) {
  return {
    error: `Fecha u hora inválida: ${date}${time ? ` ${time}` : ""}. Verificá que el día exista en el calendario (por ejemplo, febrero no tiene 30) y reintentá.`,
  }
}

/** Día de la semana local (0=domingo) de una fecha `YYYY-MM-DD`. Mediodía para no rozar el borde. */
export function localWeekday(date: string): number {
  return new Date(`${date}T12:00:00${TZ_OFFSET}`).getUTCDay()
}

export type FranjaHoraria = { opens_at: string; closes_at: string; slot_minutes: number }
export type Ocupado = { starts_at: string; ends_at: string }

/**
 * Los cupos libres de un día: las franjas de atención troceadas, menos lo que ya está ocupado.
 *
 * Es una función PURA sobre filas ya traídas — quien la llama decide cómo consultarlas y con qué
 * credencial. Devuelve horas locales `HH:mm`, y NUNCA de quién es lo ocupado: por WhatsApp le
 * responde a un titular, y los nombres de los pacientes de otros clientes no son suyos.
 */
export function calcularCupos(params: {
  date: string
  franjas: FranjaHoraria[]
  ocupados: Ocupado[]
  durationMin?: number
  tope?: number
}): string[] {
  const { date, franjas, ocupados, durationMin, tope = 40 } = params
  const ocupado = ocupados.map((a) => ({
    from: new Date(a.starts_at).getTime(),
    to: new Date(a.ends_at).getTime(),
  }))
  const cupos: string[] = []
  for (const f of franjas) {
    const paso = durationMin ?? f.slot_minutes
    if (!Number.isFinite(paso) || paso <= 0) continue
    let cursor = new Date(`${date}T${f.opens_at.slice(0, 5)}:00${TZ_OFFSET}`).getTime()
    const cierre = new Date(`${date}T${f.closes_at.slice(0, 5)}:00${TZ_OFFSET}`).getTime()
    if (!Number.isFinite(cursor) || !Number.isFinite(cierre)) continue
    while (cursor + paso * 60_000 <= cierre) {
      const fin = cursor + paso * 60_000
      const chocado = ocupado.some((a) => cursor < a.to && fin > a.from)
      if (!chocado) {
        // A hora local. Se usa la constante, no un `- 5 * 3600_000` a mano como antes: era el mismo
        // número escrito dos veces, y el comentario de arriba pedía justo lo contrario.
        const d = new Date(cursor + TZ_OFFSET_MINUTES * 60_000)
        cupos.push(
          `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`,
        )
      }
      cursor = fin
    }
  }
  return cupos.slice(0, tope)
}
