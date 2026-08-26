import type { UIMessage } from "ai"

// Precarga del historial del asistente. Vive acá y no en la página para que sea testeable sin
// arrastrar el runtime de Next (la página es un server component).
//
// Existe porque `athos_messages` guardaba la conversación desde el inicio pero el asistente se
// montaba sin ella: al recargar, el hilo se veía vacío aunque los mensajes siguieran en la base, y
// el cliente lo reportó como "historial inexistente" (§4.5 de la auditoría del Milestone 2).

/** Historial ya persistido, agrupado por paciente y en orden cronológico. */
export type StoredThreads = Record<string, UIMessage[]>

export type MensajeFila = {
  id: string
  patient_id: string | null
  role: string
  content: string
  created_at: string
  /** Clave de conversación (0092). En hilos generales es `g<timestamp>`; null en filas viejas. */
  thread_key?: string | null
}

/** Cuántos turnos se precargan por paciente. Más que la memoria del LLM (8 turnos en
 *  `athos-service/app/chat.py`) porque acá el veterinario los LEE, no sólo el modelo. */
export const TURNOS_POR_PACIENTE = 30

/** Tope global de la consulta, para que una clínica con mucho historial no infle el primer paint. */
export const TOPE_MENSAJES = 400

/**
 * Filas **más-reciente-primero** (como las trae `order created_at desc`) → hilos por paciente en
 * orden **cronológico**.
 *
 * El orden importa: la consulta pide desc para que el tope se quede con los mensajes más NUEVOS,
 * pero el hilo tiene que quedar cronológico o el veterinario lee la conversación al revés.
 */
export function agruparPorPaciente(filas: MensajeFila[]): StoredThreads {
  const out: StoredThreads = {}
  for (const f of filas) {
    const pid = f.patient_id
    // patient_id null es la consulta general: su hilo se agrupa por `thread_key` (ver abajo).
    if (!pid || !f.content?.trim()) continue
    const hilo = (out[pid] ??= [])
    if (hilo.length >= TURNOS_POR_PACIENTE) continue // ya tiene los más recientes
    // `unshift` porque las filas vienen del más reciente al más antiguo.
    hilo.unshift({
      id: f.id,
      role: f.role === "user" ? "user" : "assistant",
      parts: [{ type: "text", text: f.content }],
    })
  }
  return out
}

/**
 * Hilos GENERALES (patient_id null) agrupados por su `thread_key` (0092), cronológicos.
 *
 * Existe por el pedido del 26-ago: el chat que quedó atrás al abrir uno nuevo tiene que ser un
 * botón al que se vuelve y se sigue donde quedó. Las filas generales viejas (sin clave) se saltan:
 * no hay forma honesta de saber qué conversación eran.
 */
export function agruparPorClave(filas: MensajeFila[]): StoredThreads {
  const out: StoredThreads = {}
  for (const f of filas) {
    const clave = f.thread_key
    if (f.patient_id || !clave || !f.content?.trim()) continue
    const hilo = (out[clave] ??= [])
    if (hilo.length >= TURNOS_POR_PACIENTE) continue
    hilo.unshift({
      id: f.id,
      role: f.role === "user" ? "user" : "assistant",
      parts: [{ type: "text", text: f.content }],
    })
  }
  return out
}
