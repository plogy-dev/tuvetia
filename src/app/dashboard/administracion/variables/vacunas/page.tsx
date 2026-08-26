import { sesionDelServidor } from "@/lib/supabase/sesion"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { CatalogoDeVacunas, type VacunaDelCatalogo } from "@/components/variables/catalogo-de-vacunas"

export const metadata = { title: "Catálogo de vacunas · Tuvetia" }
export const dynamic = "force-dynamic"

// La primera «Variable» del panel (26-ago). Vacunas y no los ocho catálogos de OkVet a la vez:
// es el único cuyo dato ya trabaja — el tablero cuenta las por vencer y los avisos tienen el
// segmento de vacuna vencida. Los demás llegan cuando alguien los necesite de verdad.

export default async function VacunasPage() {
  const { supabase, user } = await sesionDelServidor()

  const { data: prof } = user
    ? await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle()
    : { data: null }

  // Archivadas incluidas: una vacuna apagada por error tiene que poder volver.
  const { data } = await supabase
    .from("vaccine_types")
    .select("id, name, species, active")
    .order("active", { ascending: false })
    .order("name")

  return (
    <PageShell width="narrow" className="flex flex-col gap-4">
      <PageHeader
        title="Catálogo de vacunas"
        description="Las vacunas que aplica tu clínica. El alta de vacunas en la ficha del paciente las ofrece para elegir en vez de teclear."
      />
      <CatalogoDeVacunas
        vacunas={(data as VacunaDelCatalogo[] | null) ?? []}
        puedeEditar={(prof as { role: string | null } | null)?.role === "admin"}
      />
    </PageShell>
  )
}
