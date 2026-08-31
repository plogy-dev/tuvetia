// Los links que acompañan al aviso de cita — Google Maps y Google Calendar.
//
// PEDIDO EN LA REUNIÓN DEL 28-AGO (Luciano, 23:17): «les llega la notificación como con este
// link de Google Maps, Google Calendar, que dice como agendar o agregar al calendario».
//
// LOS LINKS SE AGREGAN, NO SON HUECOS DE PLANTILLA. La plantilla del vet sigue siendo texto con
// sus cuatro huecos de siempre (`{paciente} {fecha} {hora} {clinica}`); el bloque de links lo
// anexa la app DESPUÉS del texto. Dos motivos: `revisarTexto` rechaza huecos desconocidos —así
// que `{mapa}` rompería todas las plantillas guardadas—, y pedirle a un veterinario que pegue
// URLs con parámetros en su plantilla es pedirle que las rompa.
//
// SIN API KEYS. Los dos links son URLs públicas de Google que no requieren credencial:
//   · Maps:     https://www.google.com/maps/search/?api=1&query=<dirección>
//   · Calendar: https://calendar.google.com/calendar/render?action=TEMPLATE&text=…&dates=…
// El de Calendar abre el editor de evento PRE-LLENADO en la cuenta del titular — quien decide
// guardarlo es él, que es exactamente el «dice como agendar» del pedido.
//
// Este archivo es PURO a propósito (sin base, sin envs): así se prueba con vitest en Node, que
// es la convención del repo para todo lo que decide formato.

/** Fecha en el formato que exige el template de Google Calendar: `YYYYMMDDTHHMMSSZ` (UTC). */
function fechaDeCalendario(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

/**
 * El link «cómo llegar». `null` cuando no hay dirección: un link de Maps a una búsqueda vacía
 * lleva a cualquier parte, y un aviso con un link roto es peor que uno sin link.
 */
export function linkDeMaps(direccion: string | null | undefined): string | null {
  const limpia = (direccion ?? "").trim()
  if (!limpia) return null
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(limpia)}`
}

/**
 * El link «agregar al calendario», con el evento pre-llenado.
 *
 * `fin` opcional: una cita sin `ends_at` se asume de 30 minutos — el template de Google EXIGE
 * `dates` con inicio y fin, y media hora es el largo de cita más común del calendario propio.
 */
export function linkDeCalendario(evento: {
  titulo: string
  inicio: string
  fin?: string | null
  direccion?: string | null
}): string {
  const inicio = fechaDeCalendario(evento.inicio)
  const fin = fechaDeCalendario(
    evento.fin ?? new Date(new Date(evento.inicio).getTime() + 30 * 60_000).toISOString(),
  )
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: evento.titulo,
    dates: `${inicio}/${fin}`,
  })
  const direccion = (evento.direccion ?? "").trim()
  if (direccion) params.set("location", direccion)
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}

/**
 * El bloque completo que se anexa al aviso, listo para WhatsApp.
 *
 * `""` cuando no hay nada que anexar. WhatsApp convierte las URLs en links solo; los emojis son
 * el rótulo — en un mensaje de texto plano no hay otra tipografía disponible.
 *
 * `conCalendario` lo decide el llamador: la CONFIRMACIÓN (al agendar) lo lleva — es el momento
 * «agendar» —; el RECORDATORIO del día antes no — agregar al calendario una cita de mañana a
 * último momento no aporta, y el mensaje corto se lee mejor.
 */
export function bloqueDeLinks(opts: {
  conCalendario: boolean
  titulo: string
  inicio: string
  fin?: string | null
  direccion?: string | null
}): string {
  const lineas: string[] = []
  const maps = linkDeMaps(opts.direccion)
  if (opts.conCalendario) {
    lineas.push(
      `📅 Agregar al calendario: ${linkDeCalendario({
        titulo: opts.titulo,
        inicio: opts.inicio,
        fin: opts.fin,
        direccion: opts.direccion,
      })}`,
    )
  }
  if (maps) lineas.push(`📍 Cómo llegar: ${maps}`)
  if (!lineas.length) return ""
  return `\n\n${lineas.join("\n")}`
}
