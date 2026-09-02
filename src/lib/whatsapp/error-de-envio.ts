// Convertir el fallo de un envío en algo que el vet pueda ACTUAR, sin filtrar nada.
//
// POR QUÉ EXISTE. La ruta de envío devolvía "No se pudo enviar el mensaje. Intenta de nuevo." para
// todo lo que no fuera "no está conectado", y la causa real sólo quedaba en `console.error`. Medido
// en vivo el 2026-08-03: el vet ve ese texto, reintenta, vuelve a fallar, y no hay forma de saber si
// el problema es el servicio caído, el número desvinculado o un mensaje rechazado — salvo entrando a
// los logs del hosting. Un mensaje genérico convierte un problema de dos minutos en uno de una hora.
//
// LA LÍNEA QUE NO SE CRUZA: se nombra la CLASE del fallo, nunca el detalle. Ni URLs, ni claves, ni
// respuestas crudas del proveedor (que sí pueden traer identificadores internos), ni el nombre del
// proveedor. Al vet le sirve saber "el servicio no respondió" para decidir si reintenta o llama a
// soporte; el resto es ruido para él y superficie para un atacante.

export type FalloDeEnvio = { texto: string; status: number }

/**
 * Fallo que el vet PUEDE resolver por su cuenta: su mensaje se le muestra tal cual.
 *
 * Es una clase y no un texto a propósito. Antes esto se decidía con `msg.includes("no está
 * conectado")`, y eso se rompe en silencio con sólo reformular una frase o agregar un caso nuevo
 * —pasó apenas se agregó el del número propio, que caía al genérico— dejando al vet con "error
 * inesperado" delante de algo que sabía resolver. Mismo criterio que en facturación, donde se dejó
 * de leer el texto del error para preguntarle a la base.
 */
export class ErrorQueElVetPuedeResolver extends Error {
  constructor(
    message: string,
    readonly status: number = 409,
    /**
     * El detalle CRUDO, para el registro de auditoría y la columna `error`. NO se le muestra al
     * vet: `message` es lo que él lee.
     *
     * Existe porque los dos usos nuevos —las acciones de Athos que se completan A MEDIAS— tienen
     * que decirle al vet algo accionable ("el titular sí se creó") sin perder el error de Postgres
     * que hace depurable el fallo. Antes eran la misma cadena y había que elegir: o el vet entendía
     * o quedaba rastro.
     */
    readonly detalle?: string,
  ) {
    super(message)
    this.name = "ErrorQueElVetPuedeResolver"
  }
}

/**
 * De qué se está hablando cuando el fallo no se pudo clasificar.
 *
 * El clasificador nació para los envíos de WhatsApp y después se aplicó a las NUEVE tools de
 * `athos/actions/[id]/execute`. Resultado: al fallar la creación de un paciente, el vet leía "No se
 * pudo **enviar el mensaje** por un error inesperado" — un mensaje que nunca existió. El texto por
 * defecto es el de siempre, así que el camino de WhatsApp no cambia en nada.
 */
// Cada contexto trae la FRASE ENTERA y no piezas para componer: así el camino de WhatsApp queda
// idéntico al carácter —"el mensaje no salió" se lee mejor que cualquier plantilla— y el texto de
// cada caso se puede leer completo acá, sin armarlo mentalmente.
export type ContextoDeFallo = {
  sinRespuesta: string
  cayo: (status: number) => string
  rechazo: (status: number) => string
  inesperado: string
}

const WHATSAPP: ContextoDeFallo = {
  sinRespuesta:
    "El servicio de WhatsApp no respondió a tiempo. El mensaje no salió; probá de nuevo en un momento.",
  // ── LO QUE ESTE MENSAJE NO PUEDE HACER: MANDAR A RECONECTAR ─────────────────────────────────
  //
  // Estuvo un rato diciendo «si te sigue pasando, desconectá y volvé a vincular el número», y era
  // un consejo peligroso. El 2-sep un 5xx sostenido resultó ser el volumen de Postgres de Evolution
  // al 100%: la conexión de WhatsApp estaba PERFECTA y lo que fallaba era que el proveedor no podía
  // escribir. Reconectar ahí no arregla nada y empeora — crear una instancia nueva también es una
  // escritura, así que el vet se habría quedado sin la que tenía y sin poder hacer una.
  //
  // Un 5xx es del SERVICIO, no de la línea. Cuando lo que se cayó es la línea, el proveedor lo
  // confirma y el mensaje lo emite `send-message.ts`, que ahí sí manda a escanear el QR. Acá la
  // única acción honesta es avisar a quien puede mirar el servidor.
  cayo: (s) =>
    `El servicio de WhatsApp está fallando (${s}). El mensaje no salió — no es tu conexión, es el servicio. Si te sigue pasando, avisá a soporte.`,
  rechazo: (s) =>
    `El servicio de WhatsApp rechazó el envío (${s}). Revisá que el número esté bien y que la conexión siga activa en Configuración.`,
  inesperado: "No se pudo enviar el mensaje por un error inesperado. Si vuelve a pasar, avisá a soporte.",
}

/**
 * Para las acciones de Athos que NO mandan nada afuera: crear una cita, un paciente, un titular,
 * actualizar una ficha.
 *
 * Con el contexto de WhatsApp, un fallo creando un paciente le decía al vet "No se pudo **enviar el
 * mensaje** por un error inesperado" — hablándole de un mensaje que nunca existió, y mandándolo a
 * revisar una conexión de WhatsApp que no tiene nada que ver.
 */
export const FALLO_DE_ACCION: ContextoDeFallo = {
  sinRespuesta: "El servicio no respondió a tiempo. La acción no se completó; probá de nuevo en un momento.",
  cayo: (s) => `El servicio está fallando (${s}). La acción no se completó.`,
  rechazo: (s) => `La acción fue rechazada (${s}). Revisá los datos de la propuesta antes de reintentar.`,
  inesperado: "No se pudo completar la acción por un error inesperado. Si vuelve a pasar, avisá a soporte.",
}

const contiene = (e: unknown, aguja: string) =>
  e instanceof Error && e.message.toLowerCase().includes(aguja)

export function clasificarFalloDeEnvio(
  e: unknown,
  ctx: ContextoDeFallo = WHATSAPP,
): FalloDeEnvio {
  // 1. Lo que el vet puede resolver: su mensaje ya está escrito para él.
  if (e instanceof ErrorQueElVetPuedeResolver) {
    return { texto: e.message, status: e.status }
  }

  // Los mismos casos expresados como texto. Quedan por compatibilidad con lo que todavía lanza
  // `Error` pelado desde otras capas; los nuevos deben usar la clase de arriba.
  if (contiene(e, "no está conectado") || contiene(e, "no tiene instancia") || contiene(e, "no tiene número")) {
    return { texto: (e as Error).message, status: 409 }
  }

  // 2. El servicio no respondió a tiempo. `AbortSignal.timeout` lanza con este nombre; es lo que se
  //    ve cuando el proveedor está caído o inalcanzable desde el servidor, y es DISTINTO de que
  //    haya rechazado el mensaje.
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError")) {
    return { texto: ctx.sinRespuesta, status: 504 }
  }

  // 3. Respondió, pero con error. El código HTTP se incluye porque es lo único que distingue "está
  //    caído" (5xx, esperar) de "rechazó esto" (4xx, revisar el número o reconectar) — y no revela
  //    nada: es el mismo número que devolvería cualquier servicio.
  const status = (e as { status?: unknown })?.status
  if (typeof status === "number") {
    return { texto: status >= 500 ? ctx.cayo(status) : ctx.rechazo(status), status: 502 }
  }

  // 4. Lo que no supimos clasificar. Sigue siendo genérico —no hay nada honesto que decir— pero se
  //    admite que es inesperado en vez de sugerir que reintentar lo va a resolver.
  return { texto: ctx.inesperado, status: 502 }
}
