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
    // patient_id null es la consulta general, que el backend trata como sin estado: no tiene hilo.
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
