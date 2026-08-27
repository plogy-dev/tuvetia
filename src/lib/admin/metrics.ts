// Métricas de plataforma para /admin — SOLO servidor (service_role: ve TODAS las clínicas).
// Agregación en JS: a los volúmenes de la mayoría de estas tablas (decenas/cientos de filas) es lo
// más simple y claro. `whatsapp_messages` ya se salió de ese rango (10.158 filas), así que las
// lecturas PAGINAN; pasadas las 100k, mover estas agregaciones a RPCs SQL.

import { paginar, TOPE } from "@/lib/admin/paginar"
import { createAdminClient } from "@/lib/supabase/admin"

type Row = Record<string, unknown>

/**
 * Lee una tabla ENTERA, paginando a paso de mil.
 *
 * POR QUÉ NO ALCANZA CON PEDIR MUCHO, que es lo que hacía antes. Esto era
 * `.limit(10000)` con esta guarda:
 *
 *     const CAP = 10000
 *     if (rows.length === CAP) console.warn(`${table} alcanzó el tope — cifras parciales`)
 *
 * Y ESA COMPARACIÓN NO PODÍA SER CIERTA NUNCA. PostgREST tiene su propio `max-rows` de mil filas:
 * pedir diez mil devuelve mil, sin error y sin aviso. O sea que `rows.length` valía 1000, la
 * comparación contra 10000 daba falso, el aviso jamás salió — y el panel reportó mil mensajes de
 * WhatsApp durante todo el tiempo que hubo diez mil (10.158 medidos contra el principal el
 * 2026-08-27; el resto de las tablas que agrega este panel no pasa de 300 filas, por eso el
 * problema se veía en una sola cifra y parecía plausible).
 *
 * EL ERROR DE FONDO, que es lo que hay que no volver a escribir: una guarda que compara contra lo
 * que uno PIDIÓ no puede detectar un recorte impuesto por una capa de más abajo. Cuánto se pide no
 * lo decide uno. La guarda honesta vive en `paginar.ts` y compara contra el tamaño de página, que
 * es la cifra que esa capa sí puede devolver.
 *
 * El `.order("id")` es lo que hace estable la paginación —las catorce tablas de acá lo tienen—:
 * sin un orden explícito Postgres no garantiza que la página 2 no repita filas de la 1, y el panel
 * contaría dos veces unas y ninguna vez otras.
 */
async function fetchAll(table: string, columns: string): Promise<Row[]> {
  const admin = createAdminClient()
  const { filas, truncado, paginas } = await paginar<Row>(async (desde, hasta) => {
    const { data, error } = await admin.from(table).select(columns).order("id").range(desde, hasta)
    if (error) throw new Error(`admin metrics ${table}: ${error.message}`)
    return (data ?? []) as unknown as Row[]
  })
  if (truncado) {
    console.warn(
      `[admin] ${table}: se cortó en ${filas.length} filas (${paginas} páginas) al llegar al tope de ${TOPE} ` +
        `y la última página vino llena — las cifras de esta tabla son parciales, toca mover la agregación a SQL`,
    )
  }
  return filas
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
