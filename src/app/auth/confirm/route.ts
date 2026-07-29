import { type EmailOtpType } from "@supabase/supabase-js"
import { redirect } from "next/navigation"
import { type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"

// Solo permite paths internos como destino (evita open redirect vía ?next=//evil.com).
function safeNext(raw: string | null): string {
  return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard"
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = safeNext(searchParams.get("next"))

  if (token_hash && type) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error && data.user) {
      // El aprovisionamiento de clínica lo garantiza la BD (trigger on_auth_user_confirmed
      // sobre auth.users.email_confirmed_at) — ya corrió antes de que este código se ejecute.
      redirect(next)
    }
    // Motivo real al login (otp_expired, etc.) para que el usuario sepa qué pasó.
    redirect(`/login?error=auth&reason=${encodeURIComponent(error?.code ?? "verify_failed")}`)
  }

  redirect("/login?error=auth&reason=missing_params")
}
