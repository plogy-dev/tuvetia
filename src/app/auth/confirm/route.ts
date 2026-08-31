import { type EmailOtpType } from "@supabase/supabase-js"
import { redirect } from "next/navigation"
import { type NextRequest } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { safeNext } from "@/lib/auth-fragment"
import { modoDeLaPuerta, puedeEntrarConLaPuertaCerrada } from "@/lib/puerta/servidor"

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
      //
      // LA MISMA PUERTA QUE `/auth/callback`, y acá es el CINTURÓN y no el tirante. Por correo el
      // pase ya se canjeó en `/signup` antes de mandar el enlace, así que este camino sólo se
      // activa para quien se saltó la pantalla —llamando `signInWithOtp({ shouldCreateUser: true })`
      // desde la consola, que es gratis de hacer—. Sin esto, ese atajo deja una sesión abierta
      // paseando por la app; la base ya le negó la clínica, pero verlo rebotar acá es más honesto
      // que dejarlo descubrir solo que no hay nada adentro.
      if (
        (await modoDeLaPuerta()) === "cerrado" &&
        !(await puedeEntrarConLaPuertaCerrada({ id: data.user.id, email: data.user.email }))
      ) {
        await supabase.auth.signOut().catch(() => {})
        redirect("/signup?motivo=sin-cuenta")
      }
      redirect(next)
    }
    // Motivo real al login (otp_expired, etc.) para que el usuario sepa qué pasó.
    redirect(`/login?error=auth&reason=${encodeURIComponent(error?.code ?? "verify_failed")}`)
  }

  redirect("/login?error=auth&reason=missing_params")
}
