// Cómo se lee el estado de una consulta. ÚNICA fuente: este mapa vivía copiado en tres pantallas.
//
// ── POR QUÉ `generating_note` NO DICE "GENERANDO" ──────────────────────────────────────────────
//
// Porque mientras la consulta está en la LISTA, nadie está generando nada. El backend deja ese
// estado al TERMINAR de transcribir (`app/transcription.py`); desde el 25-ago, ABRIR la consulta
// pide el borrador solo (`lib/consultas/nota-sola.ts`) — pero eso pasa al abrirla, no antes. La
// etiqueta se lee desde afuera, y desde afuera lo cierto es que hay una nota pendiente que se
// resuelve entrando.
//
// LA HISTORIA COMPLETA, porque este estado ya nos mintió dos veces:
//   · La etiqueta original decía "Generando nota". El vet leía que la máquina trabajaba y
//     esperaba. Medido el 22-ago: CUATRO consultas atascadas, todas con transcript, ninguna con
//     nota — a todas les faltaba un clic que nadie sabía que tenía que dar.
//   · Se cambió a "Falta generar la nota". Medido el 25-ago: SEIS atascadas, tres POSTERIORES al
//     cambio. La etiqueta honesta tampoco alcanzó: un paso que sólo avanza a mano se queda quieto
//     se llame como se llame. Por eso la generación pasó a ser automática al abrir.
//
// OJO CON EL DOC: `athos-service/docs/ATHOS_CONTEXTO_EQUIPO.md` declara este seam CERRADO desde el
// 2026-07-23 ("antes quedaba atascada en generating_note"). Lo que se cerró fue la TRANSICIÓN —que
// existe y funciona—, no el atasco. El atasco lo cerró la automatización del 25-ago.

/** Los estados que escribe el flujo del Phantom, en el orden en que ocurren. */
export const ESTADO_DE_CONSULTA: Record<string, string> = {
  open: "Abierta",
  // Éste sí es transitorio de verdad: lo sostiene el backend mientras transcribe.
  transcribing: "Transcribiendo",
  generating_note: "Nota pendiente — se genera al abrirla",
  review: "En revisión",
  completed: "Completada",
}

/** El texto para un estado, o el crudo si aparece uno que no conocemos. */
export function comoSeLee(estado: string | null | undefined): string {
  return ESTADO_DE_CONSULTA[estado ?? ""] ?? estado ?? "—"
}
