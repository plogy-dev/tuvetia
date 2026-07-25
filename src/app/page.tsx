import { redirect } from "next/navigation"

import { LoginForm } from "@/components/login-form"

// Blindaje del OAuth: si Supabase no matchea el redirectTo contra su allow-list, cae al Site URL
// (esta raíz) con ?code=... Reenviamos ese código al callback ANTES de que cargue cualquier JS
// (server-side): el callback lo intercambia con el verifier de la cookie y el login funciona igual.
// Evita además la carrera del cliente intentando el intercambio en esta página (bad_code_verifier).
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string; reason?: string }>
}) {
  const { code, error, reason } = await searchParams
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`)

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-background p-6 md:p-10">
      <div className="w-full max-w-sm">
        {/* Sin esto, los fallos de /auth/callback|confirm volvían acá EN SILENCIO. */}
        <LoginForm authError={error ?? null} authReason={reason ?? null} />
      </div>
    </div>
  )
}
