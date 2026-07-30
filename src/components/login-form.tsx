"use client"

import { useState } from "react"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Loader2Icon } from "lucide-react"

/* Glifo "chispa" de la marca Tuvetia (patrón del Sidebar del cliente). */
function BrandGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden>
      <path
        fill="var(--accent)"
        fillRule="evenodd"
        d="M32 8a24 24 0 1 0 0.001 0Z M44 22a5 5 0 1 0 0.001 0Z"
      />
    </svg>
  )
}

// Mensaje legible para los fallos que los handlers de /auth/* devuelven vía ?error=auth&reason=…
function authFailureMessage(reason: string | null): string {
  if (reason === "otp_expired")
    return "El enlace de acceso expiró o ya fue usado. Pedí uno nuevo con tu email."
  if (reason === "bad_code_verifier")
    return "El enlace debe abrirse en el mismo navegador donde lo pediste. Pedí uno nuevo acá."
  return "No pudimos completar el inicio de sesión. El enlace pudo expirar — probá de nuevo."
}

export function LoginForm({
  className,
  authError = null,
  authReason = null,
  ...props
}: React.ComponentProps<"div"> & { authError?: string | null; authReason?: string | null }) {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState<string | null>(
    authError ? authFailureMessage(authReason) : null,
  )
  const [sent, setSent] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const supabase = createClient()
    // Propaga ?next= (p.ej. /invitar/<token>) para volver ahí tras confirmar el magic link. Siempre
    // con valor (default /dashboard): la plantilla de email en Supabase le agrega &token_hash=&type=
    // al final de esta URL, y necesita que ya tenga un "?" — nunca queda vacía.
    const next = new URLSearchParams(window.location.search).get("next") ?? "/dashboard"
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
      },
    })

    setLoading(false)
    if (error) {
      // Mapeo por code (no un 400 genérico: enmascaraba validaciones y rate-limit).
      if (error.code === "otp_disabled" || error.code === "user_not_found") {
        setError("No encontramos una cuenta con ese email. ¿Ya te registraste?")
      } else if (error.status === 429 || error.code === "over_email_send_rate_limit") {
        setError("Demasiados intentos. Esperá un minuto y volvé a probar.")
      } else if (error.code === "validation_failed") {
        setError("Ese email no parece válido. Revisalo e intentá de nuevo.")
      } else {
        setError(error.message)
      }
      return
    }
    setSent(true)
  }

  async function handleGoogle() {
    setError(null)
    setGoogleLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        // Login SIN scopes sensibles -> registro sin fricción (nada de "app no verificada"). El acceso
        // a Google Calendar es opt-in aparte (botón "Conectar Google Calendar" en el calendario), así
        // solo lo consiente quien lo usa. Cuando la app pase la verificación de Google, se puede volver
        // a pedir el scope aquí para vincular en un clic sin advertencia (el callback ya lo captura).
        redirectTo: `${window.location.origin}/auth/callback${(() => {
          const next = new URLSearchParams(window.location.search).get("next")
          return next ? `?next=${encodeURIComponent(next)}` : ""
        })()}`,
      },
    })
    if (error) {
      setError(error.message)
      setGoogleLoading(false)
    }
  }

  if (sent) {
    return (
      <div className={cn("flex flex-col gap-6 text-center", className)} {...props}>
        <div className="flex flex-col items-center gap-2">
          <div className="flex size-8 items-center justify-center rounded-md">
            <BrandGlyph />
          </div>
          <h1 className="text-xl font-bold">Revisa tu correo</h1>
          <FieldDescription>
            Te enviamos un link de acceso a <strong>{email}</strong>. Ábrelo
            para iniciar sesión.
          </FieldDescription>
        </div>
        <Button variant="outline" onClick={() => setSent(false)}>
          Usar otro email
        </Button>
      </div>
    )
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <form onSubmit={handleSubmit}>
        <FieldGroup>
          <div className="flex flex-col items-center gap-2 text-center">
            <Link href="/" className="flex flex-col items-center gap-2 font-medium">
              <div className="flex size-8 items-center justify-center rounded-md">
                <BrandGlyph />
              </div>
              <span className="font-display text-[17px] font-bold tracking-[-0.02em]">
                Tuvetia
              </span>
            </Link>
            <h1 className="text-xl font-bold">Bienvenido a Tuvetia</h1>
            <FieldDescription>
              ¿No tenés cuenta? <Link href="/signup">Regístrate</Link>
            </FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor="email">Email</FieldLabel>
            <Input
              id="email"
              type="email"
              placeholder="m@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <Field>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2Icon className="animate-spin" />}
              Enviar link de acceso
            </Button>
          </Field>
          <FieldSeparator>o</FieldSeparator>
          <Field>
            <Button
              variant="outline"
              type="button"
              onClick={handleGoogle}
              disabled={googleLoading}
            >
              {googleLoading ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path
                    d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
                    fill="currentColor"
                  />
                </svg>
              )}
              Continuar con Google
            </Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        Al continuar, aceptás nuestros{" "}
        <Link href="/legal/terminos">Términos de servicio</Link> y{" "}
        <Link href="/legal/privacidad">Política de privacidad</Link>.
      </FieldDescription>
    </div>
  )
}
