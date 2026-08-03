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
  ) {
    super(message)
    this.name = "ErrorQueElVetPuedeResolver"
  }
}

const contiene = (e: unknown, aguja: string) =>
  e instanceof Error && e.message.toLowerCase().includes(aguja)

export function clasificarFalloDeEnvio(e: unknown): FalloDeEnvio {
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
    return {
      texto: "El servicio de WhatsApp no respondió a tiempo. El mensaje no salió; probá de nuevo en un momento.",
      status: 504,
    }
  }

  // 3. Respondió, pero con error. El código HTTP se incluye porque es lo único que distingue "está
  //    caído" (5xx, esperar) de "rechazó esto" (4xx, revisar el número o reconectar) — y no revela
  //    nada: es el mismo número que devolvería cualquier servicio.
  const status = (e as { status?: unknown })?.status
  if (typeof status === "number") {
    return {
      texto:
        status >= 500
          ? `El servicio de WhatsApp está fallando (${status}). El mensaje no salió.`
          : `El servicio de WhatsApp rechazó el envío (${status}). Revisá que el número esté bien y que la conexión siga activa en Configuración.`,
      status: 502,
    }
  }

  // 4. Lo que no supimos clasificar. Sigue siendo genérico —no hay nada honesto que decir— pero se
  //    admite que es inesperado en vez de sugerir que reintentar lo va a resolver.
  return {
    texto: "No se pudo enviar el mensaje por un error inesperado. Si vuelve a pasar, avisá a soporte.",
    status: 502,
  }
}
