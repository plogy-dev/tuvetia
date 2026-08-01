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

/**
 * Igual que `fetchAll`, pero una tabla ausente devuelve `[]` en vez de tumbar el panel entero.
 *
 * Existe por el flujo de migraciones de este repo: los `.sql` se aplican al principal A MANO
 * (dev → PR → principal, `MIGRACIONES.md`), así que el código puede estar desplegado horas antes
 * que su tabla. Sin esto, desplegar el panel antes de aplicar la 0046 dejaría /admin en error 500 —
 * y lo que se pierde es UNA línea de costos, no las otras once métricas.
 */
async function fetchAllOpcional(table: string, columns: string): Promise<Row[]> {
  try {
    return await fetchAll(table, columns)
  } catch (e) {
    console.warn(`[admin] ${table} no disponible (¿migración sin aplicar?) — se omite:`, e)
    return []
  }
}

export type PlatformMetrics = {
  clinics: { id: string; name: string; phone: string | null; email: string | null; city: string | null; subscription_status: string | null; created_at: string }[]
  profiles: { id: string; clinic_id: string | null; full_name: string | null; phone: string | null; role: string | null; is_active: boolean | null; created_at: string }[]
  memberships: { clinic_id: string; user_id: string; role: string | null }[]
  invitations: { clinic_id: string; email: string; role: string | null; accepted_at: string | null; expires_at: string | null; created_at: string }[]
  patients: { clinic_id: string }[]
  consultations: { clinic_id: string; started_at: string }[]
  notes: { clinic_id: string; status: string; ai_model: string | null }[]
  answers: { clinic_id: string; model: string | null; created_at: string }[]
  retrievals: { clinic_id: string; tier_reached: string | null; created_at: string }[]
  messages: { clinic_id: string; created_at: string }[]
  audios: { clinic_id: string; duration_secs: number | null; file_size: number | null; created_at: string }[]
  waMessages: { clinic_id: string; created_at: string }[]
  waIntegrations: { clinic_id: string; provider: string | null; status: string; phone_number: string | null }[]
  /** Uso del agente de Next con TOKENS reales (migración 0046). Vacío si aún no se aplicó. */
  agentUsage: {
    clinic_id: string
    user_id: string | null
    surface: string
    provider: string
    model: string
    fell_back_from: string | null
    tokens_in: number | null
    tokens_out: number | null
    created_at: string
  }[]
}

export async function loadPlatformMetrics(): Promise<PlatformMetrics> {
  const [
    clinics, profiles, memberships, invitations, patients, consultations, notes,
    answers, retrievals, messages, audios, waMessages, waIntegrations, agentUsage,
  ] = await Promise.all([
    fetchAll("clinics", "id, name, phone, email, city, subscription_status, created_at"),
    fetchAll("profiles", "id, clinic_id, full_name, phone, role, is_active, created_at"),
    // `memberships` es la fuente de verdad multi-clínica; `profiles.clinic_id` es sólo la ACTIVA.
    fetchAll("memberships", "clinic_id, user_id, role"),
    fetchAll("invitations", "clinic_id, email, role, accepted_at, expires_at, created_at"),
    fetchAll("patients", "clinic_id"),
    fetchAll("consultations", "clinic_id, started_at"),
    fetchAll("clinical_notes", "clinic_id, status, ai_model"),
    fetchAll("rag_answer_log", "clinic_id, model, created_at"),
    fetchAll("rag_retrieval_log", "clinic_id, tier_reached, created_at"),
    fetchAll("athos_messages", "clinic_id, created_at"),
    fetchAll("consultation_audios", "clinic_id, duration_secs, file_size, created_at"),
    fetchAll("whatsapp_messages", "clinic_id, created_at"),
    // `provider` existe desde la 0028 y nadie la leía: por eso el panel cobraba Kapso con
    // integraciones de Evolution.
    fetchAll("whatsapp_integrations", "clinic_id, provider, status, phone_number"),
    fetchAllOpcional(
      "athos_agent_usage",
      "clinic_id, user_id, surface, provider, model, fell_back_from, tokens_in, tokens_out, created_at",
    ),
  ])
  return {
    clinics, profiles, memberships, invitations, patients, consultations, notes,
    answers, retrievals, messages, audios, waMessages, waIntegrations, agentUsage,
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
