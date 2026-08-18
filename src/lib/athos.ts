// Cliente del microservicio Athos (RAG clínico). Llama /athos/chat (SSE) y /athos/phantom/suggest
// con el JWT de Supabase del usuario. La URL base viene de NEXT_PUBLIC_ATHOS_URL.
import { sinNombresDeProveedor } from "@/lib/sin-proveedores"
import type { BandaDeEvidencia } from "@/lib/evidencia"
import { createClient } from "@/lib/supabase/client"

const ATHOS_URL = process.env.NEXT_PUBLIC_ATHOS_URL ?? ""

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = createClient()
  const {
    data: { session },
  } = await supabase.auth.getSession()
  return {
    "Content-Type": "application/json",
    ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
  }
}

// Arma el mensaje que ve el vet a partir de una respuesta fallida del microservicio.
//
// El `detail` de FastAPI se superficia a propósito: sin él el toast sólo decía "Athos respondió
// 500" y escondía la causa real (falta una credencial, la consulta no tiene audio, el usuario no
// pertenece a la clínica). Pero se superficia TACHADO — llegó a traer el nombre del proveedor de
// transcripción y 200 caracteres de su cuerpo crudo. Ver `lib/sin-proveedores.ts` para por qué el
// arreglo de origen no alcanza.
async function mensajeDeError(res: Response): Promise<string> {
  const detail = await res
    .clone()
    .json()
    .then((b) => (b as { detail?: string })?.detail)
    .catch(() => null)
  const limpio = detail ? sinNombresDeProveedor(detail) : ""
  return `Athos respondió ${res.status}${limpio ? `: ${limpio}` : ""}`
}

export type Citation = {
  chunk_id: string
  doc_id: string
  locator?: string | null
  source?: string | null
  url?: string | null // link directo al artículo (PubMed/DOI), del corpus
  title?: string | null // título del documento
  year?: number | null // año de publicación
}

export type ChatDone = {
  citations: Citation[]
  allergy_gate_triggered: boolean
  insufficient_evidence: boolean
  ai_model: string
}

export type ChatHandlers = {
  onWarning?: (text: string) => void
  onToken?: (text: string) => void
  onDone?: (d: ChatDone) => void
  onError?: (e: unknown) => void
}

// Consume el stream SSE de /athos/chat y despacha eventos {warning, token, done}.
export async function athosChat(
  // patientId vacío/omitido = consulta general (sin paciente): el backend responde sin ficha ni memoria.
  params: { question: string; patientId?: string | null; clinicId: string },
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch(`${ATHOS_URL}/athos/chat`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        question: params.question,
        patient_id: params.patientId || null,
        clinic_id: params.clinicId,
      }),
      signal,
    })
    if (!res.ok || !res.body) throw new Error(`Athos respondió ${res.status}`)

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split("\n\n")
      buffer = events.pop() ?? "" // el último trozo puede estar incompleto
      for (const evt of events) {
        const line = evt.trim()
        if (!line.startsWith("data:")) continue
        const payload = JSON.parse(line.slice(5).trim())
        if (payload.type === "warning") handlers.onWarning?.(payload.text)
        else if (payload.type === "token") handlers.onToken?.(payload.text)
        else if (payload.type === "done") handlers.onDone?.(payload)
      }
    }
  } catch (e) {
    if ((e as Error)?.name !== "AbortError") handlers.onError?.(e)
  }
}

// Alerta de condición clínica relevante (no bloqueante). `detail` es el panel "afectaciones en este
// paciente", que llega cuando se habilite la generación con IA (hoy null).
export type ConditionAlert = {
  condition: string
  mesh?: string | null
  severity?: string
  source?: string
  detail?: string | null
}

export type PhantomResponse = {
  note_id: string
  status: string
  soap: { subjective: string; objective: string; assessment: string; plan: string }
  allergy_gate_triggered: boolean
  allergy_transcript_flag: boolean
  /**
   * `true` sólo cuando la banda es `none`. Se mantiene por compatibilidad.
   *
   * NO ALCANZA, y por eso está `evidence_level` abajo: este booleano colapsa tres bandas en dos y
   * deja `limited` —"la literatura no cubre este cuadro"— indistinguible de `sufficient`. El
   * servicio manda las tres desde el 2026-07-28; el front declaraba sólo ésta y la nota clínica se
   * quedaba sin la señal que el chat sí muestra.
   */
  insufficient_evidence: boolean
  /** La banda del juez de evidencia. `insufficient_evidence` equivale a `evidence_level === "none"`. */
  evidence_level: BandaDeEvidencia
  citations: Citation[]
  alerts?: ConditionAlert[]
  ai_model: string
  ai_generated_at: string
}

// Modo Fantasma: pide la sugerencia de nota SOAP al cerrar una consulta.
export async function athosPhantomSuggest(params: {
  consultationId: string
  clinicId: string
}): Promise<PhantomResponse> {
  const res = await fetch(`${ATHOS_URL}/athos/phantom/suggest`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      consultation_id: params.consultationId,
      clinic_id: params.clinicId,
    }),
  })
  if (!res.ok) throw new Error(`Athos respondió ${res.status}`)
  return (await res.json()) as PhantomResponse
}

export type LiveResponse = {
  texto: string
  /** Todavía no hay con qué. Se pinta como "escuchando", NO como un error. */
  sin_material: boolean
  /** El guard de dosis tapó cifras por peso (regla 4): la ficha está incompleta. */
  dosis_redactadas: boolean
  alergias_severas: string[]
}

/**
 * Notas y sugerencias MIENTRAS la consulta pasa.
 *
 * VA POR `/api/athos/live` Y NO DIRECTO AL MICROSERVICIO, a diferencia del resto de este archivo.
 * El tope mensual por clínica vive en Next (`athos_agent_usage`), así que un gasto que no pasa por
 * una ruta nuestra no se cuenta — y éste es el que más hay que contar: se dispara solo, decenas de
 * veces por consulta, mientras el veterinario atiende y sin que nadie apriete nada.
 *
 * NO ESCRIBE NADA en la historia clínica: lo que devuelve es un cuaderno que se mira y se descarta.
 * La nota que entra a la historia sigue siendo la del cierre, con aprobación humana.
 *
 * EL TRANSCRIPT VIAJA DESDE ACÁ y no se lee de la base porque durante la consulta todavía no está
 * persistido — se guarda al cerrar. La FICHA, en cambio, la resuelve el servidor: el peso y la
 * especie gobiernan el guard de dosis y no pueden venir del cliente. El `clinic_id` también sale de
 * la sesión del lado servidor, no de acá.
 *
 * CUÁNDO SE LLAMA lo decide `lib/consulta-viva/disparador.ts`, por contenido nuevo y con techo por
 * consulta. Acá no hay ninguna cadencia.
 */
export async function athosLive(params: {
  consultationId: string
  patientId?: string | null
  transcript: string
  motivo?: string | null
  modo: "notas" | "sugerencias"
  signal?: AbortSignal
}): Promise<LiveResponse> {
  const res = await fetch("/api/athos/live", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      consultation_id: params.consultationId,
      patient_id: params.patientId || null,
      transcript: params.transcript,
      motivo: params.motivo || null,
      modo: params.modo,
    }),
    signal: params.signal,
  })
  if (!res.ok) throw new Error(`Athos respondió ${res.status}`)
  return (await res.json()) as LiveResponse
}

export type TranscribeResponse = {
  transcript_id: string
  full_text: string
  stt_model: string
}

// Modo Fantasma: transcribe el audio ya subido de una consulta.
export async function athosTranscribe(params: {
  consultationId: string
  clinicId: string
}): Promise<TranscribeResponse> {
  const res = await fetch(`${ATHOS_URL}/athos/transcribe`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      consultation_id: params.consultationId,
      clinic_id: params.clinicId,
    }),
  })
  if (!res.ok) throw new Error(await mensajeDeError(res))
  return (await res.json()) as TranscribeResponse
}

export type WhatsappSuggestResponse = {
  draft: string
}

// Bandeja de WhatsApp: pide a Athos un BORRADOR de respuesta al titular (el vet edita y aprueba
// antes de enviar — Athos nunca envía). agent_mode=review.
export async function athosWhatsappSuggest(params: {
  clinicId: string
  ownerName?: string | null
  messages: { direction: "inbound" | "outbound"; body: string }[]
}): Promise<WhatsappSuggestResponse> {
  const res = await fetch(`${ATHOS_URL}/athos/whatsapp/suggest`, {
    method: "POST",
    headers: await authHeaders(),
    body: JSON.stringify({
      clinic_id: params.clinicId,
      owner_name: params.ownerName ?? null,
      messages: params.messages,
    }),
  })
  if (!res.ok) throw new Error(await mensajeDeError(res))
  return (await res.json()) as WhatsappSuggestResponse
}
