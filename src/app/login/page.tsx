import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"

export const metadata = { title: "Ingresar · Tuvetia" }

// Blindaje del OAuth: la raíz (landing) reenvía ?code= a /auth/callback; conservamos el mismo
// reenvío acá por si algún flujo aterriza en /login con el código (misma semántica que la
// antigua raíz-login, commit 3203eb4): server-side, antes de cargar cualquier JS, para evitar
// la carrera del cliente intentando el intercambio (bad_code_verifier).
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>
}) {
  const { code } = await searchParams
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`)

  return (
    <div className="app-theme relative flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="relative z-[1] w-full max-w-sm">
        <LoginForm />
      </div>
    </div>
  )
}
