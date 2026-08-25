// El recordatorio de cita: a qué citas les toca hoy, y qué se les escribe.
//
// ── DE DÓNDE SALE ─────────────────────────────────────────────────────────────────────────────
//
// Del documento de cambios (24-ago), punto de Santiago: «confirmaciones y recordatorios de citas
// por WhatsApp (no solo correo) — es la vía principal en Colombia». El cuándo lo decidió Felipe el
// 25-ago: 24 horas antes, y configurable.
//
// ── LA GRANULARIDAD ES EL DÍA, Y ESTE ARCHIVO NO LO DISIMULA ──────────────────────────────────
//
// El barrido corre UNA VEZ AL DÍA: cuelga del cron de cartera de las 9 a. m., porque el plan de
// Vercel da dos crons diarios y los dos ya están usados. Con eso, «24 horas antes» se cumple como
// «la mañana anterior» — para una cita de mañana a las 10, el mensaje sale hoy a las 9.
//
// Por eso la anticipación se redondea a días y el mínimo es UN día. Ofrecer «6 horas antes» sería
// aceptar una configuración que la máquina no puede cumplir, y eso se descubre cuando un titular no
// recibe el aviso que la pantalla prometía.
//
// El dato se guarda en HORAS igual (no en días) para que el día que haya un barrido más frecuente
// no haya que migrar nada.

/** Los huecos que el sistema sabe llenar en el texto del recordatorio. */
export const HUECOS_DE_CITA = ["paciente", "fecha", "hora", "clinica"] as const
export type HuecoDeCita = (typeof HUECOS_DE_CITA)[number]

/**
 * Sin `{fecha}` y sin `{hora}` el mensaje no sirve: «tiene una cita» no le dice a nadie cuándo.
 * `{paciente}` y `{clinica}` son ayuda, no requisito — hay clínicas de un solo vet donde el titular
 * sabe perfectamente de quién le hablan.
 */
const OBLIGATORIOS: HuecoDeCita[] = ["fecha", "hora"]

export const LARGO_MAXIMO = 600

export const TEXTO_POR_DEFECTO =
  "Le recordamos la cita de {paciente} en {clinica}: {fecha} a las {hora}. " +
  "Si no puede asistir, escríbanos por acá y la reprogramamos."

/**
 * Cuántos días antes se avisa, a partir de las horas configuradas.
 *
 * Mínimo UNO: con un barrido diario, «el mismo día» significaría avisar a las 9 a. m. de una cita
 * de las 9:30, que no le sirve a nadie para reorganizarse — y para las citas de la mañana temprano
 * el aviso saldría DESPUÉS de la cita.
 */
export function diasDeAnticipacion(horas: number): number {
  if (!Number.isFinite(horas) || horas <= 0) return 1
  return Math.max(1, Math.round(horas / 24))
}

/**
 * Qué día (`YYYY-MM-DD`, en Bogotá) le toca avisar en esta corrida.
 *
 * Se calcula sobre la fecha CIVIL y no sumando milisegundos: sumar 24 h a un instante da la hora
 * equivalente del día siguiente, que con un cambio de huso o un salto de mes puede caer en el día
 * equivocado. Acá lo que importa es el día del calendario colombiano.
 */
export function diaAAvisar(horas: number, ahora: Date): string {
  const hoyBogota = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(ahora)
  const [y, m, d] = hoyBogota.split("-").map(Number)
  // `Date.UTC` con el día desplazado: no hay husos de por medio porque ya se partió la fecha civil.
  const objetivo = new Date(Date.UTC(y, m - 1, d + diasDeAnticipacion(horas)))
  return objetivo.toISOString().slice(0, 10)
}

/** Los huecos que aparecen en un texto, sin repetir. */
export function huecosDe(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{([a-zA-Z_]+)\}/g)].map((m) => m[1]))]
}

/** Revisa el texto antes de guardarlo. Devuelve el problema en español, o `null`. */
export function revisarTexto(texto: string): string | null {
  const t = texto.trim()
  if (!t) return "El mensaje no puede quedar vacío."
  if (t.length > LARGO_MAXIMO) {
    return `El mensaje no puede pasar de ${LARGO_MAXIMO} caracteres (va en ${t.length}).`
  }
  const presentes = huecosDe(t)
  const faltan = OBLIGATORIOS.filter((h) => !presentes.includes(h))
  if (faltan.length > 0) {
    return `Falta ${faltan.map((h) => `{${h}}`).join(" y ")}: sin eso el titular no sabe cuándo es la cita.`
  }
  const desconocidos = presentes.filter((h) => !HUECOS_DE_CITA.includes(h as HuecoDeCita))
  if (desconocidos.length > 0) {
    return `${desconocidos.map((h) => `{${h}}`).join(", ")} no ${
      desconocidos.length === 1 ? "existe" : "existen"
    }: saldría tal cual en el WhatsApp del titular. Se pueden usar ${HUECOS_DE_CITA.map(
      (h) => `{${h}}`,
    ).join(", ")}.`
  }
  return null
}

/**
 * Llena los huecos.
 *
 * Reemplaza TODAS las apariciones y con una función de reemplazo — es la misma lección que dejaron
 * las plantillas de cobranza el 24-ago: `.replace` con una cadena cambia sólo la primera, y
 * interpreta `$&` y `$1` del valor como referencias al match.
 */
export function llenarTexto(
  texto: string,
  valores: Record<HuecoDeCita, string>,
): string {
  return texto.replace(
    /\{(paciente|fecha|hora|clinica)\}/g,
    (_, hueco: HuecoDeCita) => valores[hueco],
  )
}

/** Cómo se escribe la fecha y la hora de una cita para un titular colombiano. */
export function fechaYHora(startsAt: string): { fecha: string; hora: string } {
  const d = new Date(startsAt)
  return {
    fecha: new Intl.DateTimeFormat("es-CO", {
      weekday: "long",
      day: "numeric",
      month: "long",
      timeZone: "America/Bogota",
    }).format(d),
    hora: new Intl.DateTimeFormat("es-CO", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/Bogota",
    }).format(d),
  }
}

/**
 * Los estados de cita a los que SÍ se les avisa.
 *
 * Una cancelada no lleva recordatorio —sería avisar de algo que no va a pasar— y una que ya
 * ocurrió tampoco. Es lista blanca: un estado nuevo no entra solo.
 */
export const ESTADOS_QUE_SE_AVISAN = ["scheduled", "confirmed"] as const
