// Cliente del microservicio Athos (RAG clínico). Llama /athos/chat (SSE) y /athos/phantom/suggest
// con el JWT de Supabase del usuario. La URL base viene de NEXT_PUBLIC_ATHOS_URL.
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
  params: { question: string; patientId: string; clinicId: string },
  handlers: ChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  try {
    const res = await fetch(`${ATHOS_URL}/athos/chat`, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        question: params.question,
        patient_id: params.patientId,
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
  insufficient_evidence: boolean
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
