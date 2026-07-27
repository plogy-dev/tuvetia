import { redirect } from "next/navigation"

import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { OnboardingTour } from "@/components/onboarding-tour"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { createClient } from "@/lib/supabase/server"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("full_name, onboarded_at, clinic_id, setup_completed_at")
          .eq("id", user.id)
          .single()
      ).data
    : null

  // Vet nuevo (creador de clínica) sin el wizard completado -> a /bienvenida. Los invitados nunca
  // caen aquí (accept_invitation marca setup_completed_at) ni los usuarios preexistentes (backfill 0017).
  const p = profile as {
    full_name: string | null
    onboarded_at: string | null
    clinic_id: string | null
    setup_completed_at: string | null
  } | null
  if (p?.clinic_id && !p.setup_completed_at) redirect("/bienvenida")

  const { data: clinic } = p?.clinic_id
    ? await supabase.from("clinics").select("name, logo_url").eq("id", p.clinic_id).maybeSingle()
    : { data: null }
  const c = clinic as { name: string; logo_url: string | null } | null

  const sidebarUser = {
    name: profile?.full_name || user?.email || "Usuario",
    email: user?.email ?? "",
    avatar: "",
  }
  const sidebarClinic = { name: c?.name ?? "TuvetIA", logoUrl: c?.logo_url ?? null }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={sidebarUser} clinic={sidebarClinic} />
      <OnboardingTour onboarded={Boolean((profile as { onboarded_at?: string | null } | null)?.onboarded_at)} />
      <SidebarInset>
        <SiteHeader />
        <div className="flex flex-1 flex-col">
          <div className="@container/main flex flex-1 flex-col gap-2">
            {children}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
