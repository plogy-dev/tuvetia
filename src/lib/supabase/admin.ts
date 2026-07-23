import { createClient } from "@supabase/supabase-js"

// Cliente service_role — SOLO servidor (route handlers / server actions). NUNCA importar desde un
// client component: se salta RLS y puede leer secretos (refresh_token de calendar_integrations).
// Requiere SUPABASE_SERVICE_ROLE_KEY en el entorno del servidor (Vercel), jamás expuesto al navegador.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY para el cliente admin (Google Calendar sync).",
    )
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
