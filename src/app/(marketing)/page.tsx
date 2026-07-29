import { redirect } from "next/navigation"

import Landing from "@/components/landing/Landing"

// Blindaje del OAuth (heredado de la antigua raíz-login): si Supabase no matchea el redirectTo
// contra su allow-list, cae al Site URL (esta raíz) con ?code=... Reenviamos ese código al
// callback ANTES de que cargue cualquier JS (server-side): el callback lo intercambia con el
// verifier de la cookie y el login funciona igual. Evita además la carrera del cliente
// intentando el intercambio en esta página (bad_code_verifier).
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; error?: string }>
}) {
  const { code } = await searchParams
  if (code) redirect(`/auth/callback?code=${encodeURIComponent(code)}`)

  return <Landing />
}
