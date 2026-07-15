import { NextResponse, type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { ensureClinicForUser } from "@/lib/supabase/ensure-clinic"

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = searchParams.get("next") ?? "/dashboard"

  if (code) {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error && data.user) {
      await ensureClinicForUser(supabase, data.user)
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/?error=auth`)
}
