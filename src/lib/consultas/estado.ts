// Cómo se lee el estado de una consulta. ÚNICA fuente: este mapa vivía copiado en tres pantallas.
//
// ── POR QUÉ `generating_note` NO DICE "GENERANDO" ──────────────────────────────────────────────
//
// Porque no está generando nada. El backend pone ese estado al TERMINAR de transcribir
// (`app/transcription.py`), y de ahí sólo se sale cuando un humano abre la consulta y aprieta
// "Generar sugerencia (Modo Fantasma)" — es un botón, no una tarea de fondo. Mientras nadie lo
// apriete, la consulta se queda ahí para siempre.
//
// La etiqueta decía "Generando nota", que es justo lo que hace que nadie lo apriete: el vet lee que
// la máquina está trabajando y espera. Medido el 2026-08-22 contra producción: CUATRO consultas
// atascadas en ese estado, de cuatro días distintos (17, 21 y dos del 22), todas con transcript y
// ninguna con nota. Ninguna falló — a todas les faltaba un clic que nadie sabía que tenía que dar.
//
// OJO CON EL DOC: `athos-service/docs/ATHOS_CONTEXTO_EQUIPO.md` declara este seam CERRADO desde el
// 2026-07-23 ("antes quedaba atascada en generating_note"). Lo que se cerró fue la TRANSICIÓN —que
// existe y funciona—, no el atasco: la transición depende de una acción humana que la etiqueta
// desalienta. Un estado del que sólo se sale a mano tiene que decir que la pelota es tuya.

/** Los estados que escribe el flujo del Phantom, en el orden en que ocurren. */
export const ESTADO_DE_CONSULTA: Record<string, string> = {
  open: "Abierta",
  // Éste sí es transitorio de verdad: lo sostiene el backend mientras transcribe.
  transcribing: "Transcribiendo",
  generating_note: "Falta generar la nota",
  review: "En revisión",
  completed: "Completada",
}

/** El texto para un estado, o el crudo si aparece uno que no conocemos. */
export function comoSeLee(estado: string | null | undefined): string {
  return ESTADO_DE_CONSULTA[estado ?? ""] ?? estado ?? "—"
}
