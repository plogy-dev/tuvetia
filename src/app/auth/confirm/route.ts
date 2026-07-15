import { type EmailOtpType } from "@supabase/supabase-js"
import { redirect } from "next/navigation"
import { type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureClinicForUser } from "@/lib/supabase/ensure-clinic"

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const token_hash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const next = searchParams.get("next") ?? "/dashboard"

  if (token_hash && type) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error && data.user) {
      await ensureClinicForUser(supabase, data.user)
      redirect(next)
    }
  }

  redirect("/?error=auth")
}
