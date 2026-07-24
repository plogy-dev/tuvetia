import Link from "next/link"
import { notFound } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { isPlatformAdmin } from "@/lib/platform-admin"

// Panel de plataforma — AJENO al producto: layout propio (sin sidebar clínico) y gate por
// PLATFORM_ADMIN_EMAILS. Quien no está en la allowlist recibe 404 (el panel es invisible).
// Todas las páginas hijas asumen este gate y consultan con service_role.
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!isPlatformAdmin(user?.email)) notFound()

  const nav = [
    { href: "/admin", label: "Resumen" },
    { href: "/admin/clinicas", label: "Clínicas" },
    { href: "/admin/uso", label: "Uso IA" },
    { href: "/admin/costos", label: "Costos" },
  ]

  return (
    <div className="min-h-svh bg-background">
      <header className="border-b">
        <div className="mx-auto flex h-12 w-full max-w-5xl items-center gap-4 px-4">
          <div className="flex items-center gap-1.5 text-sm font-bold">
            <ShieldCheck className="size-4" /> TuvetIA · Admin
          </div>
          <nav className="flex items-center gap-3 text-sm text-muted-foreground">
            {nav.map((n) => (
              <Link key={n.href} href={n.href} className="hover:text-foreground">
                {n.label}
              </Link>
            ))}
          </nav>
          <Link href="/dashboard" className="ml-auto text-xs text-muted-foreground hover:text-foreground">
            ← Volver al producto
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6">{children}</main>
    </div>
  )
}
