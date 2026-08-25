import { HeartPulse } from "lucide-react"

import { sesionDelServidor } from "@/lib/supabase/sesion"
import { listarPlanes } from "@/lib/planes-salud/consultas"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { EmptyState } from "@/components/ui/empty-state"
import { PlanesDeSalud } from "@/components/planes-salud/planes-de-salud"

export const metadata = { title: "Planes de salud · Tuvetia" }

// Se pinta en el servidor. Un plan cambia dos veces al año: no hay nada que refrescar en vivo.
export const dynamic = "force-dynamic"

export default async function PlanesSaludPage() {
  const { supabase, user } = await sesionDelServidor()

  const { data: prof } = user
    ? await supabase.from("profiles").select("clinic_id, role").eq("id", user.id).maybeSingle()
    : { data: null }
  const p = prof as { clinic_id: string | null; role: string | null } | null

  if (!p?.clinic_id) {
    return (
      <PageShell className="flex flex-col gap-4">
        <PageHeader title="Planes de salud" />
        <EmptyState
          icon={<HeartPulse className="size-6" />}
          title="Tu usuario todavía no está en una clínica"
          description="Los planes de salud son de la clínica: primero hay que pertenecer a una."
        />
      </PageShell>
    )
  }

  // Los archivados también: si no, un plan que se apagó por error queda invisible y sin forma de
  // volver a encenderlo. La tarjeta los muestra atenuados.
  const [planes, { data: itemsRows }] = await Promise.all([
    listarPlanes(supabase, p.clinic_id, { incluirInactivos: true }),
    supabase
      .from("catalog_items")
      .select("id, name, item_type, price_cents")
      .eq("clinic_id", p.clinic_id)
      .eq("active", true)
      .order("name"),
  ])

  return (
    <PageShell className="flex flex-col gap-4">
      <PageHeader
        title="Planes de salud"
        description="Paquetes de servicios que la clínica le vende a un paciente: «3 consultas y 2 vacunas al año»."
      />
      <PlanesDeSalud
        planes={planes}
        catalogo={
          (itemsRows as
            | { id: string; name: string; item_type: string; price_cents: number }[]
            | null) ?? []
        }
        puedeEditar={p.role === "admin"}
      />
    </PageShell>
  )
}
