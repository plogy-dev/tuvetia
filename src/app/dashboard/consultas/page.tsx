import Link from "next/link"
import { ChevronDownIcon, ChevronRightIcon, GhostIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { createClient } from "@/lib/supabase/server"
import { NewConsultationDrawer } from "@/components/new-consultation-drawer"

const CONSULTATION_STATUS: Record<string, string> = {
  open: "Abierta",
  transcribing: "Transcribiendo",
  generating_note: "Generando nota",
  review: "En revisión",
  completed: "Completada",
}

const NOTE_STATUS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "outline" }
> = {
  draft: { label: "Borrador", variant: "secondary" },
  approved: { label: "Aprobada", variant: "default" },
  locked: { label: "Bloqueada", variant: "outline" },
}

type ConsultationRow = {
  id: string
  status: string
  chief_complaint: string | null
  started_at: string
  // PostgREST devuelve el embed to-one (patient_id -> patients.id) como objeto,
  // pero el query builder no tipado lo infiere como arreglo.
  patient: { id: string; name: string; species: string } | null
  notes: { id: string; status: string }[] | null
}

type PatientGroup = {
  id: string
  name: string
  species: string
  consultas: ConsultationRow[]
  latest: number // ts de la consulta más reciente (para ordenar los grupos)
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

export default async function ConsultasPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string }>
}) {
  const { orden } = await searchParams
  const asc = orden === "asc" // por defecto: más recientes primero

  const supabase = await createClient()
  const { data } = await supabase
    .from("consultations")
    .select(
      "id, status, chief_complaint, started_at, patient:patients(id, name, species), notes:clinical_notes(id, status)"
    )
    .order("started_at", { ascending: false })
    .limit(200)
  const consultas = (data as unknown as ConsultationRow[] | null) ?? []

  // Agrupar por paciente; dentro de cada grupo, ordenar por fecha según el filtro.
  const groups = new Map<string, PatientGroup>()
  for (const c of consultas) {
    const pid = c.patient?.id ?? "—"
    const g = groups.get(pid) ?? {
      id: pid,
      name: c.patient?.name ?? "Sin paciente",
      species: c.patient?.species ?? "",
      consultas: [],
      latest: 0,
    }
    g.consultas.push(c)
    g.latest = Math.max(g.latest, new Date(c.started_at).getTime())
    groups.set(pid, g)
  }
  const ordered = [...groups.values()].sort((a, b) =>
    asc ? a.latest - b.latest : b.latest - a.latest
  )
  for (const g of ordered) {
    g.consultas.sort((a, b) => {
      const ta = new Date(a.started_at).getTime()
      const tb = new Date(b.started_at).getTime()
      return asc ? ta - tb : tb - ta
    })
  }

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GhostIcon className="size-5 text-muted-foreground" />
          <h1 className="text-lg font-semibold">Phantom — notas de consulta</h1>
        </div>
        <NewConsultationDrawer />
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Al cerrar una consulta, Athos redacta una nota SOAP con citas verificables de
        literatura veterinaria. Revísala, edítala y apruébala: ninguna nota entra a la
        historia clínica sin tu aprobación.
      </p>

      {/* Filtro por fecha de la consulta */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Ordenar por fecha:
        </span>
        <Link
          href="/dashboard/consultas"
          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
            !asc
              ? "border-transparent bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-secondary"
          }`}
        >
          Más recientes
        </Link>
        <Link
          href="/dashboard/consultas?orden=asc"
          className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
            asc
              ? "border-transparent bg-primary text-primary-foreground"
              : "bg-background text-muted-foreground hover:bg-secondary"
          }`}
        >
          Más antiguas
        </Link>
      </div>

      {ordered.length === 0 && (
        <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          No hay consultas todavía. Crea una con “Nueva consulta” y el Phantom redactará
          la nota al cerrar.
        </div>
      )}

      {/* Un desplegable por paciente con sus consultas */}
      <div className="flex flex-col gap-3">
        {ordered.map((g, gi) => (
          <details
            key={g.id}
            open={gi === 0}
            className="group rounded-xl border bg-card shadow-sm"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-bold">
                {g.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{g.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {g.species || "—"} · última consulta {fmtDate(new Date(g.latest).toISOString())}
                </span>
              </span>
              <Badge variant="secondary" className="shrink-0 text-xs">
                {g.consultas.length}{" "}
                {g.consultas.length === 1 ? "consulta" : "consultas"}
              </Badge>
              <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </summary>
            <div className="divide-y border-t">
              {g.consultas.map((c) => {
                const note = c.notes?.[0]
                const noteMeta = note ? NOTE_STATUS[note.status] : null
                return (
                  <Link
                    key={c.id}
                    href={`/dashboard/consultas/${c.id}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                  >
                    <span className="w-28 shrink-0 font-mono text-xs text-muted-foreground">
                      {fmtDate(c.started_at)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                      {c.chief_complaint ?? "—"}
                    </span>
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {CONSULTATION_STATUS[c.status] ?? c.status}
                    </span>
                    {noteMeta ? (
                      <Badge variant={noteMeta.variant} className="shrink-0 text-xs">
                        {noteMeta.label}
                      </Badge>
                    ) : (
                      <span className="shrink-0 text-xs text-muted-foreground">Sin nota</span>
                    )}
                    <ChevronRightIcon className="size-4 shrink-0 text-primary" />
                  </Link>
                )
              })}
            </div>
          </details>
        ))}
      </div>
    </div>
  )
}
