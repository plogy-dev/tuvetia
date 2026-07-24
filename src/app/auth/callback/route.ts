import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureClinicForUser } from "@/lib/supabase/ensure-clinic"
import { upsertGoogleIntegration } from "@/lib/google-calendar"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      await ensureClinicForUser(supabase, data.user)

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

  return NextResponse.redirect(`${origin}/?error=auth`)
}
