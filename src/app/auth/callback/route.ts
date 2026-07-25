import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureClinicForUser } from "@/lib/supabase/ensure-clinic"
import { upsertGoogleIntegration } from "@/lib/google-calendar"

// Solo permite paths internos como destino (evita open redirect vía ?next=//evil.com).
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard"
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeNext(searchParams.get("next"))

  let reason = "missing_code"
  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    reason = error?.code ?? "exchange_failed"
    if (!error && data.user) {
      // El aprovisionamiento de clínica NO debe bloquear el login: si falla, igual entramos (el
      // layout redirige a /bienvenida si falta setup). Antes, un error aquí devolvía 500 con el
      // code ya consumido -> el usuario no podía reintentar.
      try {
        await ensureClinicForUser(supabase, data.user)
      } catch (e) {
        console.error("ensureClinicForUser falló (no bloquea el login):", e)
      }

      // Vinculación de calendario de un clic: si el login con Google trajo un refresh token (porque el
      // usuario concedió el scope calendar.events en el mismo consentimiento), lo guardamos. Best-effort:
      // un fallo aquí (p.ej. sin service_role configurado) NUNCA debe romper el login.
      const refreshToken = data.session?.provider_refresh_token
      if (refreshToken) {
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("clinic_id")
            .eq("id", data.user.id)
            .maybeSingle()
          const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
          if (clinicId) await upsertGoogleIntegration(data.user.id, clinicId, refreshToken)
        } catch {
          /* no romper el login por la vinculación de calendario */
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Motivo real al login (bad_code_verifier, etc.) para que el usuario sepa qué pasó.
  return NextResponse.redirect(`${origin}/?error=auth&reason=${encodeURIComponent(reason)}`)
}
