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

export function SignupForm({
  className,
  ...props
}: React.ComponentProps<"div">) {
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [microsoftLoading, setMicrosoftLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        shouldCreateUser: true,
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(next)}`,
        data: {
          full_name: fullName,
          phone,
        },
      },
    })

    setLoading(false)
    if (error) {
      setError(error.message)
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
        // Igual que login-form: el registro NO pide permisos de calendario (calendario v3). Se
        // conecta a mano desde Conexiones, eligiendo proveedor.
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

  async function handleMicrosoft() {
    setError(null)
    setMicrosoftLoading(true)
    const supabase = createClient()
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        // Igual que Google: sin scope de calendario. Outlook se conecta desde Conexiones.
        scopes: "email",
        redirectTo: `${window.location.origin}/auth/callback${(() => {
          const next = new URLSearchParams(window.location.search).get("next")
          return next ? `?next=${encodeURIComponent(next)}` : ""
        })()}`,
      },
    })
    if (error) {
      setError(error.message)
      setMicrosoftLoading(false)
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
            para activar tu cuenta y configurar tu clínica.
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
            <Link
              href="/"
              className="flex flex-col items-center gap-2 font-medium"
            >
              <div className="flex size-8 items-center justify-center rounded-md">
                <BrandGlyph />
              </div>
              <span className="font-display text-[17px] font-bold tracking-[-0.02em]">
                Tuvetia
              </span>
            </Link>
            <h1 className="text-xl font-bold">Crea tu cuenta en Tuvetia</h1>
            <FieldDescription>
              ¿Ya tienes cuenta? <Link href="/login">Inicia sesión</Link>
            </FieldDescription>
          </div>
          <Field>
            <FieldLabel htmlFor="full_name">Nombre completo</FieldLabel>
            <Input
              id="full_name"
              placeholder="Dra. Ana Pérez"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
            />
          </Field>
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
          <Field>
            <FieldLabel htmlFor="phone">Teléfono</FieldLabel>
            <Input
              id="phone"
              type="tel"
              placeholder="+57 300 123 4567"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </Field>
          {error && <FieldError>{error}</FieldError>}
          <Field>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2Icon className="animate-spin" />}
              Crear cuenta
            </Button>
          </Field>
          <FieldSeparator>Or</FieldSeparator>
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
              Continue with Google
            </Button>
          </Field>
          <Field>
            <Button
              variant="outline"
              type="button"
              onClick={handleMicrosoft}
              disabled={microsoftLoading}
            >
              {microsoftLoading ? (
                <Loader2Icon className="animate-spin" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 23 23" width="16" height="16" aria-hidden>
                  <path fill="#f25022" d="M1 1h10v10H1z" />
                  <path fill="#00a4ef" d="M1 12h10v10H1z" />
                  <path fill="#7fba00" d="M12 1h10v10H12z" />
                  <path fill="#ffb900" d="M12 12h10v10H12z" />
                </svg>
              )}
              Continue with Microsoft
            </Button>
          </Field>
        </FieldGroup>
      </form>
      <FieldDescription className="px-6 text-center">
        Al crear tu cuenta, aceptas nuestros{" "}
        <Link href="/legal/terminos">Términos de servicio</Link> y{" "}
        <Link href="/legal/privacidad">Política de privacidad</Link>.
      </FieldDescription>
    </div>
  )
}
