// Métricas de plataforma para /admin — SOLO servidor (service_role: ve TODAS las clínicas).
// Agregación en JS: a los volúmenes actuales (decenas/cientos de filas) es lo más simple y claro.
// NOTA de escala: con >100 clínicas o >100k filas de logs, mover estas agregaciones a RPCs SQL.

import { createAdminClient } from "@/lib/supabase/admin"

const CAP = 10000 // guarda: si algún fetch llega al tope, las cifras serían parciales (se loguea)

type Row = Record<string, unknown>

async function fetchAll(table: string, columns: string): Promise<Row[]> {
  const admin = createAdminClient()
  const { data, error } = await admin.from(table).select(columns).limit(CAP)
  if (error) throw new Error(`admin metrics ${table}: ${error.message}`)
  const rows = (data ?? []) as unknown as Row[]
  if (rows.length === CAP) console.warn(`[admin] ${table} alcanzó el tope de ${CAP} filas — cifras parciales`)
  return rows
}

export type PlatformMetrics = {
  clinics: { id: string; name: string; created_at: string }[]
  profiles: { clinic_id: string | null }[]
  patients: { clinic_id: string }[]
  consultations: { clinic_id: string; started_at: string }[]
  notes: { clinic_id: string; status: string; ai_model: string | null }[]
  answers: { clinic_id: string; model: string | null; created_at: string }[]
  retrievals: { clinic_id: string; tier_reached: string | null; created_at: string }[]
  messages: { clinic_id: string; created_at: string }[]
  audios: { clinic_id: string; duration_secs: number | null; file_size: number | null; created_at: string }[]
  waMessages: { clinic_id: string; created_at: string }[]
  waIntegrations: { clinic_id: string; status: string; phone_number: string | null }[]
}

export async function loadPlatformMetrics(): Promise<PlatformMetrics> {
  const [
    clinics, profiles, patients, consultations, notes,
    answers, retrievals, messages, audios, waMessages, waIntegrations,
  ] = await Promise.all([
    fetchAll("clinics", "id, name, created_at"),
    fetchAll("profiles", "clinic_id"),
    fetchAll("patients", "clinic_id"),
    fetchAll("consultations", "clinic_id, started_at"),
    fetchAll("clinical_notes", "clinic_id, status, ai_model"),
    fetchAll("rag_answer_log", "clinic_id, model, created_at"),
    fetchAll("rag_retrieval_log", "clinic_id, tier_reached, created_at"),
    fetchAll("athos_messages", "clinic_id, created_at"),
    fetchAll("consultation_audios", "clinic_id, duration_secs, file_size, created_at"),
    fetchAll("whatsapp_messages", "clinic_id, created_at"),
    fetchAll("whatsapp_integrations", "clinic_id, status, phone_number"),
  ])
  return {
    clinics, profiles, patients, consultations, notes,
    answers, retrievals, messages, audios, waMessages, waIntegrations,
  } as PlatformMetrics
}

// Helpers de agregación
export const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString()
export const countBy = <T,>(rows: T[], key: (r: T) => string | null | undefined) => {
  const out = new Map<string, number>()
  for (const r of rows) {
    const k = key(r) ?? "—"
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}
export const since = <T extends { created_at?: string; started_at?: string }>(rows: T[], iso: string) =>
  rows.filter((r) => (r.created_at ?? r.started_at ?? "") >= iso)
