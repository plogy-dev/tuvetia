// Lo que está esperando a alguien en la clínica, calculado con consultas a la base y CERO IA.
//
// POR QUÉ EXISTE. Athos sabía responder pero no sabía qué estaba pasando: no había forma de que
// dijera "quedaron tres notas sin aprobar" o "hay un titular esperando respuesta desde ayer". El
// andamiaje para mostrarlo ya estaba —`PendienteDelRiel`, `resumenDelDia` y el riel de la clínica—
// y su propio comentario lo admitía: «hoy `pendientes` trae como mucho cartera».
//
// ESTO NO GASTA UN TOKEN, y es la mitad barata de "ser consciente de qué está pasando". El briefing
// redactado (Fase 3) va encima de esto, no en su lugar: si el modelo falla o está apagado, las
// señales siguen ahí.
//
// FUNCIONES PURAS que reciben FILAS. No consultan la base: quien las llama ya trajo los datos —la
// pantalla del asistente hace todas sus consultas en paralelo— y así se prueban con una tabla de
// casos en vitest, que corre en `environment: "node"`.

/** Una cosa que espera a alguien. La forma la fija `PendienteDelRiel`, que ya la pinta. */
export type Pendiente = {
  id: string
  etiqueta: string
  detalle: string
}

/**
 * El orden en que se atienden, de más a menos urgente.
 *
 * EL CRITERIO: primero lo que tiene a una PERSONA DE AFUERA esperando. Un titular que escribió y no
 * recibió respuesta está esperando ahora; una nota sin aprobar es trabajo del vet consigo mismo, y
 * una vacuna que vence en tres semanas no es de hoy. Ordenar por "cuánto duele" y no por "qué es
 * más fácil de contar" es lo que hace que la primera línea del riel sea la que hay que mirar.
 */
const ORDEN = [
  "conversaciones",
  "tareas-cartera",
  "notas-sin-aprobar",
  "cobros-vencidos",
  "vacunas",
] as const

const plural = (n: number, uno: string, varios: string) => (n === 1 ? `1 ${uno}` : `${n} ${varios}`)

// ── Notas clínicas sin aprobar ────────────────────────────────────────────────────────────────

/**
 * Una nota en `draft` NO está en la historia clínica: Athos la redactó y nadie la firmó.
 *
 * Medido contra el principal el 2026-08-16: **18 notas en borrador**. No es un caso teórico — es
 * trabajo clínico a medio terminar que hoy no se ve desde ninguna pantalla de inicio.
 */
export function notasSinAprobar(notas: { status: string }[]): Pendiente | null {
  const n = notas.filter((x) => x.status === "draft").length
  if (n === 0) return null
  return {
    id: "notas-sin-aprobar",
    etiqueta: plural(n, "nota sin aprobar", "notas sin aprobar"),
    detalle: "No entran a la historia clínica hasta que las firmes",
  }
}

// ── Conversaciones sin responder ──────────────────────────────────────────────────────────────

export type MensajeParaSenal = {
  owner_id: string | null
  direction: string
  created_at: string
}

/**
 * Titulares cuyo ÚLTIMO mensaje es entrante: escribieron y nadie contestó.
 *
 * Se calcula por titular y no por mensaje: tres mensajes seguidos del mismo dueño son UNA
 * conversación esperando, no tres. Los mensajes sin `owner_id` se ignoran — no se puede decir a
 * quién habría que responderle.
 */
export function conversacionesSinResponder(mensajes: MensajeParaSenal[]): Pendiente | null {
  const ultimoPorTitular = new Map<string, MensajeParaSenal>()
  for (const m of mensajes) {
    if (!m.owner_id) continue
    const previo = ultimoPorTitular.get(m.owner_id)
    if (!previo || m.created_at > previo.created_at) ultimoPorTitular.set(m.owner_id, m)
  }
  const esperando = [...ultimoPorTitular.values()].filter((m) => m.direction === "inbound")
  if (esperando.length === 0) return null

  // El más viejo primero: es el que lleva más tiempo esperando.
  const masViejo = esperando.reduce((a, b) => (a.created_at < b.created_at ? a : b))
  return {
    id: "conversaciones",
    etiqueta: plural(esperando.length, "titular sin respuesta", "titulares sin respuesta"),
    detalle: `El más antiguo escribió el ${masViejo.created_at.slice(0, 10)}`,
  }
}

// ── Vacunas ───────────────────────────────────────────────────────────────────────────────────

/** Cuántos días hacia adelante se considera "por vencer". Un mes es el horizonte de una agenda. */
export const DIAS_DE_VACUNA = 30

export type VacunaParaSenal = { next_dose_at: string | null }

/**
 * Refuerzos vencidos o a punto de vencer.
 *
 * Vencido y por vencer se cuentan JUNTOS pero el detalle separa los vencidos: son dos acciones
 * distintas —llamar hoy vs. agendar— y un solo número que las mezcle no le sirve a nadie.
 */
export function vacunasPorVencer(
  vacunas: VacunaParaSenal[],
  hoyISO: string,
  dias: number = DIAS_DE_VACUNA,
): Pendiente | null {
  const limite = new Date(`${hoyISO}T00:00:00-05:00`)
  limite.setUTCDate(limite.getUTCDate() + dias)
  const limiteISO = limite.toISOString().slice(0, 10)

  const enVentana = vacunas.filter(
    (v): v is { next_dose_at: string } => !!v.next_dose_at && v.next_dose_at <= limiteISO,
  )
  if (enVentana.length === 0) return null

  const vencidas = enVentana.filter((v) => v.next_dose_at < hoyISO).length
  return {
    id: "vacunas",
    etiqueta: plural(enVentana.length, "refuerzo por vencer", "refuerzos por vencer"),
    detalle: vencidas > 0 ? `${vencidas} ya vencidos` : `En los próximos ${dias} días`,
  }
}

// ── Tareas escaladas a una persona ────────────────────────────────────────────────────────────

/**
 * Cartera escala a una persona cuando no puede seguir sola: un titular que discute la factura, un
 * canal revocado, una respuesta que el clasificador no entendió. Alguien ya recibió la promesa de
 * que un humano lo iba a mirar.
 */
export function tareasEsperandoAUnaPersona(tareas: { status: string }[]): Pendiente | null {
  const n = tareas.filter((t) => t.status === "open").length
  if (n === 0) return null
  return {
    id: "tareas-cartera",
    etiqueta: plural(n, "caso de cobranza para revisar", "casos de cobranza para revisar"),
    detalle: "Cartera los escaló porque no puede resolverlos sola",
  }
}

// ── Cobros vencidos ───────────────────────────────────────────────────────────────────────────

/**
 * Se conserva tal cual estaba en la pantalla del asistente, sólo que ahora vive acá con las demás.
 * El formato del monto también: `$ 1.234.567`, con puntos de miles como se escribe en Colombia.
 */
export function cobrosVencidos(cuantas: number, totalCents: number): Pendiente | null {
  if (cuantas === 0) return null
  const pesos = Math.trunc(totalCents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".")
  return {
    id: "cobros-vencidos",
    etiqueta: plural(cuantas, "cobro vencido", "cobros vencidos"),
    detalle: `$ ${pesos}`,
  }
}

// ── Todo junto ────────────────────────────────────────────────────────────────────────────────

/**
 * Las señales de la clínica, ordenadas por urgencia y sin las que no aplican.
 *
 * Devuelve `[]` cuando no hay nada pendiente, y eso también es información: el riel no pinta la
 * sección y el prompt no agrega línea. "Nada pendiente" no se anuncia — se nota.
 */
export function pendientesDeLaClinica(s: {
  notas?: { status: string }[]
  mensajes?: MensajeParaSenal[]
  vacunas?: VacunaParaSenal[]
  tareas?: { status: string }[]
  cobros?: { cuantas: number; totalCents: number }
  hoyISO: string
}): Pendiente[] {
  const todas = [
    s.mensajes ? conversacionesSinResponder(s.mensajes) : null,
    s.tareas ? tareasEsperandoAUnaPersona(s.tareas) : null,
    s.notas ? notasSinAprobar(s.notas) : null,
    s.cobros ? cobrosVencidos(s.cobros.cuantas, s.cobros.totalCents) : null,
    s.vacunas ? vacunasPorVencer(s.vacunas, s.hoyISO) : null,
  ].filter((p): p is Pendiente => p !== null)

  return todas.sort(
    (a, b) =>
      ORDEN.indexOf(a.id as (typeof ORDEN)[number]) - ORDEN.indexOf(b.id as (typeof ORDEN)[number]),
  )
}

/**
 * Las señales como líneas del prompt del agente.
 *
 * Es la mitad de "ser consciente" que no cuesta un token: el modelo entra a la conversación sabiendo
 * qué está esperando, sin que nadie se lo pregunte.
 *
 * Devuelve `null` sin pendientes: una línea que diga "no hay nada pendiente" se paga todos los
 * turnos y no cambia ninguna respuesta.
 */
export function pendientesParaElPrompt(pendientes: Pendiente[]): string | null {
  if (pendientes.length === 0) return null
  const lista = pendientes.map((p) => `${p.etiqueta} (${p.detalle})`).join("; ")
  return (
    `En la clínica hay pendientes ahora mismo: ${lista}. ` +
    `Si el vet pregunta qué tiene pendiente o por dónde empezar, respondé con esto — ya lo sabés, no ` +
    `hace falta que busques.`
  )
}
