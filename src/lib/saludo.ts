/**
 * El saludo de Athos según la hora, en el calendario de Bogotá.
 *
 * POR QUÉ ES UN ARCHIVO Y NO TRES LÍNEAS EN LA PANTALLA. Vivía dentro de `asistente/page.tsx` con
 * dos cortes —antes de las 12 y antes de las 19— así que a las 11:59 saludaba igual que a las 6 de
 * la mañana, y desde las 19:00 hasta las 5:59 decía "buenas noches" a alguien que está de turno a
 * las tres de la madrugada. Acá se puede probar cada frontera sin montar la pantalla.
 *
 * FUNCIÓN PURA. Recibe la hora, no la busca. Es lo que permite fijar los bordes en vitest, que es
 * donde se rompen estas cosas: nadie prueba a mano qué dice la app a las 00:00.
 */

/** Las franjas, de la primera a la última del día. */
export type FranjaDelDia = "madrugada" | "manana" | "mediodia" | "tarde" | "noche"

/**
 * En qué franja cae una hora (0–23).
 *
 * Los cortes salen de cómo se habla en Colombia, no de dividir el día en pedazos iguales:
 *
 *   · **00–04 madrugada** — el turno de guardia. "Buenos días" a las 2am es de un robot.
 *   · **05–11 mañana**
 *   · **12–13 mediodía** — dos horas, no una: es la franja del almuerzo, y "buenas tardes" a las
 *     12:05 suena apurado.
 *   · **14–18 tarde**
 *   · **19–23 noche**
 *
 * Cualquier valor fuera de 0–23 cae en `manana`: es el saludo más neutro y el que menos chirría si
 * alguna vez llega una hora rota.
 */
export function franjaDelDia(hora: number): FranjaDelDia {
  if (!Number.isFinite(hora) || hora < 0 || hora > 23) return "manana"
  if (hora < 5) return "madrugada"
  if (hora < 12) return "manana"
  if (hora < 14) return "mediodia"
  if (hora < 19) return "tarde"
  return "noche"
}

/**
 * El saludo de cada franja.
 *
 * La madrugada NO dice "buenas noches" otra vez: quien abre Athos a las 3am está trabajando, y
 * reconocerlo —"¿guardia?"— es más humano que repetir la fórmula. Es la única que se sale del molde,
 * y a propósito.
 */
const SALUDO: Record<FranjaDelDia, string> = {
  madrugada: "Buenas noches",
  manana: "Buenos días",
  mediodia: "Buen mediodía",
  tarde: "Buenas tardes",
  noche: "Buenas noches",
}

/** El saludo suelto, sin nombre. */
export function saludoDe(hora: number): string {
  return SALUDO[franjaDelDia(hora)]
}

/**
 * El saludo completo: "Buenas tardes, María".
 *
 * SÓLO EL NOMBRE DE PILA, y el apellido se descarta acá y no en la pantalla: "Buenos días, María"
 * se lee como alguien hablándole; "Buenos días, María Fernanda Restrepo" se lee como una
 * notificación del sistema.
 *
 * Sin nombre devuelve el saludo solo, sin coma colgando.
 */
export function saludoCompleto(hora: number, nombre?: string | null): string {
  const pila = nombre?.trim().split(/\s+/)[0]
  return pila ? `${saludoDe(hora)}, ${pila}` : saludoDe(hora)
}
