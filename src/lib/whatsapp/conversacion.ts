import "server-only"

// El estado de una conversación de WhatsApp, contra la base. La lógica pura está en
// `datos-de-la-cita.ts`, `intencion.ts` y `respuestas-de-rescate.ts`.
//
// TODO ACÁ FALLA ABIERTO, y no es una precaución de más: quien llama es `auto-reply.ts`, que corre
// dentro del `after()` de un webhook sin nadie mirando. Si la tabla 0101 no está aplicada, si
// Supabase tiene un hipo o si el jsonb viene torcido, el modo automático tiene que seguir
// comportándose exactamente como antes — respondiendo o callándose— y nunca romper el webhook.
// Por eso ninguna función de este archivo lanza: devuelven un estado vacío y dejan un log.

import { createAdminClient } from "@/lib/supabase/admin"

import type { DatosDeLaCita } from "./datos-de-la-cita"
import type { Intencion } from "./intencion"

export type EstadoDeLaConversacion = {
  id: string | null
  intencion: Intencion
  estado: "recolectando" | "confirmando" | "resuelta" | "entregada_al_vet"
  datos: DatosDeLaCita
  mensajesSinAvance: number
}

/** Lo que se asume cuando no hay fila todavía, o cuando leerla falló. */
const EN_BLANCO: EstadoDeLaConversacion = {
  id: null,
  intencion: "general",
  estado: "recolectando",
  datos: {},
  mensajesSinAvance: 0,
}

export async function leerConversacion(
  clinicId: string,
  conversationKey: string,
): Promise<EstadoDeLaConversacion> {
  try {
    const { data, error } = await createAdminClient()
      .from("whatsapp_conversation_state")
      .select("id, intencion, estado, datos, mensajes_sin_avance")
      .eq("clinic_id", clinicId)
      .eq("conversation_key", conversationKey)
      .maybeSingle()

    if (error) {
      console.error("[wa/conversacion] no se pudo leer el estado:", error.message)
      return EN_BLANCO
    }
    if (!data) return EN_BLANCO

    const f = data as {
      id: string
      intencion: string
      estado: string
      datos: unknown
      mensajes_sin_avance: number
    }
    return {
      id: f.id,
      intencion: (f.intencion as Intencion) ?? "general",
      estado: (f.estado as EstadoDeLaConversacion["estado"]) ?? "recolectando",
      // El jsonb es un borrador sin CHECK en la base (a propósito, ver 0101): si viene con una forma
      // que no esperamos, mejor arrancar de cero que arrastrar basura al prompt.
      datos: f.datos && typeof f.datos === "object" && !Array.isArray(f.datos) ? (f.datos as DatosDeLaCita) : {},
      mensajesSinAvance: Number.isFinite(f.mensajes_sin_avance) ? f.mensajes_sin_avance : 0,
    }
  } catch (e) {
    console.error("[wa/conversacion] no se pudo consultar el estado:", (e as Error).message)
    return EN_BLANCO
  }
}

/**
 * Guarda el estado después de un turno.
 *
 * `datos` se MEZCLA con lo que ya había, no lo reemplaza: cada turno aporta lo que pudo sacar, y un
 * reemplazo borraría el nombre que se juntó tres mensajes atrás. Los `null`/`undefined` que llegan
 * no pisan nada — sólo se escribe lo que tiene valor.
 */
export async function guardarConversacion(input: {
  clinicId: string
  conversationKey: string
  intencion: Intencion
  estado: EstadoDeLaConversacion["estado"]
  datos: DatosDeLaCita
  mensajesSinAvance: number
  motivo?: string | null
  actionId?: string | null
  appointmentId?: string | null
}): Promise<void> {
  try {
    const { error } = await createAdminClient()
      .from("whatsapp_conversation_state")
      .upsert(
        {
          clinic_id: input.clinicId,
          conversation_key: input.conversationKey,
          intencion: input.intencion,
          estado: input.estado,
          datos: input.datos,
          mensajes_sin_avance: input.mensajesSinAvance,
          motivo: input.motivo ?? null,
          action_id: input.actionId ?? null,
          appointment_id: input.appointmentId ?? null,
          updated_at: new Date().toISOString(),
        },
        // La unicidad de la 0101: un upsert por conversación, sin lee-decide-escribe en el medio.
        { onConflict: "clinic_id,conversation_key" },
      )
    if (error) console.error("[wa/conversacion] no se pudo guardar el estado:", error.message)
  } catch (e) {
    console.error("[wa/conversacion] no se pudo guardar el estado:", (e as Error).message)
  }
}

/**
 * Deja constancia de que este turno no se contestó, y por qué.
 *
 * Existe para los cuatro caminos que hoy cortan el modo automático con un `return` seco —tope
 * diario, tope por chat, plan free, sin cupo de IA—. Ninguno deja rastro de ningún tipo, y por eso
 * «¿por qué VetGPT no contestó?» sólo se puede responder leyendo código. Acá el rescate NO manda
 * nada: mandarlo derrotaría la rampa anti-baneo, que es la razón de ser de esos topes.
 */
export async function anotarQueNoSeContesto(input: {
  clinicId: string
  conversationKey: string
  motivo: string
}): Promise<void> {
  const previo = await leerConversacion(input.clinicId, input.conversationKey)
  // Sólo importa si había algo abierto: anotar cada mensaje suelto que no se contestó llenaría la
  // tabla de ruido que nadie va a mirar.
  if (previo.intencion !== "cita") return

  await guardarConversacion({
    clinicId: input.clinicId,
    conversationKey: input.conversationKey,
    intencion: previo.intencion,
    estado: "entregada_al_vet",
    datos: previo.datos,
    mensajesSinAvance: previo.mensajesSinAvance,
    motivo: input.motivo,
  })
}

/** Mezcla lo nuevo sobre lo viejo sin dejar que un `null` borre un dato ya juntado. */
export function mezclarDatos(previos: DatosDeLaCita, nuevos: DatosDeLaCita): DatosDeLaCita {
  const salida: DatosDeLaCita = { ...previos }
  for (const [k, v] of Object.entries(nuevos)) {
    if (v === null || v === undefined) continue
    if (typeof v === "string" && v.trim() === "") continue
    ;(salida as Record<string, unknown>)[k] = v
  }
  return salida
}
