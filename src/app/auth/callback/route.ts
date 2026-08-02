import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-fragment"
import { upsertGoogleIntegration } from "@/lib/google-calendar"
import { upsertMicrosoftIntegration } from "@/lib/microsoft-calendar"

// Esta ruta atiende el retorno de OAuth (login con Google): el flujo lo inició el NAVEGADOR, existe
// el `code_verifier` de PKCE y Supabase devuelve `?code=`.
//
// Un enlace de CORREO es otra cosa: lo inicia el servidor, no hay `code_verifier`, y Supabase
// devuelve los tokens en el FRAGMENTO (`#access_token=…`). El fragmento no viaja al servidor, así
// que acá llega una petición sin código. Antes eso terminaba en `/login?reason=missing_code` — y era
// exactamente el fallo del invitado sin cuenta. Ahora se deriva a `/auth/sesion`, que corre en el
// navegador y sí puede leerlo; el fragmento sobrevive a la redirección (RFC 7231 §7.1.2).

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeNext(searchParams.get("next"))

  // Sin `code` no es un error todavía: puede ser un enlace de correo con la sesión en el fragmento.
  // Sólo el navegador puede saberlo, así que se le pregunta a él.
  if (!code) {
    return NextResponse.redirect(
      `${origin}/auth/sesion?next=${encodeURIComponent(next)}&reason=missing_code`,
    )
  }

  let reason = "missing_code"
  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    reason = error?.code ?? "exchange_failed"
    if (!error && data.user) {
      // El aprovisionamiento de clínica lo garantiza la BD (trigger on_auth_user_confirmed
      // sobre auth.users.email_confirmed_at) — ya corrió antes de que este código se ejecute.

      // Vinculación de calendario de un clic: si el login con Google o Microsoft trajo un refresh
      // token (porque el usuario concedió el scope de calendario en el mismo consentimiento), lo
      // guardamos — pero SOLO si quien loguea es el administrador de su clínica (clinics.owner_id,
      // ver 0048_calendar_admin_redesign): desde ese cambio hay una única cuenta por clínica, así
      // que vincular la de un vet cualquiera quedaría inerte y confunde ("¿por qué dice conectado
      // si el calendario compartido no lo usa?"). Best-effort: un fallo aquí (p.ej. sin service_role
      // configurado) NUNCA debe romper el login. `app_metadata.provider` refleja el proveedor recién
      // usado en ESTE sign-in.
      const refreshToken = data.session?.provider_refresh_token
      if (refreshToken) {
        try {
          const { data: prof } = await supabase
            .from("profiles")
            .select("clinic_id")
            .eq("id", data.user.id)
            .maybeSingle()
          const clinicId = (prof as { clinic_id: string | null } | null)?.clinic_id
          if (clinicId) {
            const { data: clinic } = await supabase
              .from("clinics")
              .select("owner_id")
              .eq("id", clinicId)
              .maybeSingle()
            const isAdmin = (clinic as { owner_id: string | null } | null)?.owner_id === data.user.id
            if (isAdmin) {
              const provider = (data.user as unknown as { app_metadata?: { provider?: string } })
                .app_metadata?.provider
              if (provider === "azure") {
                await upsertMicrosoftIntegration(data.user.id, clinicId, refreshToken)
              } else {
                await upsertGoogleIntegration(data.user.id, clinicId, refreshToken)
              }
            }
          }
        } catch {
          /* no romper el login por la vinculación de calendario */
        }
      }

      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  // Motivo real al login (bad_code_verifier, etc.) para que el usuario sepa qué pasó.
  return NextResponse.redirect(`${origin}/login?error=auth&reason=${encodeURIComponent(reason)}`)
}
