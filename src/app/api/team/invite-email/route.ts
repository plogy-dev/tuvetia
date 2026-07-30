import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { getAppBaseUrl } from "@/lib/base-url"

// Envío best-effort del email de invitación (misma infra SMTP del magic link, vía
// auth.admin.inviteUserByEmail). Si falla (p.ej. el email ya tiene cuenta), no pasa nada:
// el LINK de invitación es siempre el camino garantizado. Autoriza que la invitación
// exista y pertenezca a la clínica del solicitante.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { token?: string }
  if (!body.token) return NextResponse.json({ error: "Falta token" }, { status: 400 })

  const { data: prof } = await supabase
    .from("profiles")
    .select("clinic_id, role")
    .eq("id", user.id)
    .maybeSingle()
  const p = prof as { clinic_id: string | null; role: string | null } | null
  if (!p?.clinic_id || p.role !== "admin") {
    return NextResponse.json({ error: "Solo administradores" }, { status: 403 })
  }

  try {
    const admin = createAdminClient()
    const { data: inv } = await admin
      .from("invitations")
      .select("email, clinic_id")
      .eq("token", body.token)
      .is("accepted_at", null)
      .maybeSingle()
    const invitation = inv as { email: string; clinic_id: string } | null
    if (!invitation || invitation.clinic_id !== p.clinic_id) {
      return NextResponse.json({ error: "Invitación no encontrada" }, { status: 404 })
    }

    // El destino tiene que ser /auth/callback, NO /invitar/<token> directo: esa página sólo lee la
    // sesión con getUser() y no canjea el `?code=` de PKCE que trae el enlace del correo. Al
    // aterrizar ahí sin sesión, el invitado veía "Inicia sesión o crea tu cuenta" — el enlace del
    // correo "no hacía nada" (los 2 intentos fallidos que reportó el cliente). /auth/callback hace
    // el exchangeCodeForSession y después redirige al `next`, que valida contra open redirect.
    // Y el origin sale de getAppBaseUrl(): `new URL(req.url).origin` daba el dominio del deployment
    // de preview, que no está en la allow-list de Redirect URLs de Supabase.
    const base = getAppBaseUrl()
    const next = encodeURIComponent(`/invitar/${body.token}`)
    const { error } = await admin.auth.admin.inviteUserByEmail(invitation.email, {
      redirectTo: `${base}/auth/callback?next=${next}`,
    })
    // Falla típica: el email ya tiene cuenta -> no es un error para nosotros (usará el link).
    return NextResponse.json({ sent: !error, reason: error?.message ?? null })
  } catch (e) {
    return NextResponse.json({ sent: false, reason: (e as Error).message })
  }
}
