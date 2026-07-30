import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"

// Cierra la sesión y redirige. Existe para el caso "esta invitación es para otro correo": la página
// pedía cerrar sesión pero su botón sólo navegaba, así que el usuario volvía autenticado con la
// cuenta equivocada y chocaba con el mismo muro (callejón sin salida reportado en la auditoría).
//
// Es POST a propósito: con GET, el prefetch de <Link> de Next cerraría la sesión con sólo pasar el
// mouse por encima.

// Sólo destinos internos (evita open redirect vía ?next=//evil.com). Mismo criterio que
// /auth/callback.
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/login"
}

export async function POST(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const next = safeNext(searchParams.get("next"))
  const supabase = await createClient()
  // Best-effort: si la sesión ya no existe, igual hay que llevar al usuario a donde va.
  await supabase.auth.signOut().catch(() => {})
  return NextResponse.redirect(`${origin}${next}`, { status: 303 })
}
