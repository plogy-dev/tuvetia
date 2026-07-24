import Link from "next/link"
import { ChevronDownIcon, ChevronRightIcon, GhostIcon, SearchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
  latest: number
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CO", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })
}

// Construye la URL de la sección preservando los demás filtros activos.
function hrefWith(p: { orden?: string; q?: string; nota?: string }): string {
  const sp = new URLSearchParams()
  if (p.orden === "asc") sp.set("orden", "asc")
  if (p.q) sp.set("q", p.q)
  if (p.nota) sp.set("nota", p.nota)
  const s = sp.toString()
  return "/dashboard/consultas" + (s ? `?${s}` : "")
}

const NOTA_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todas" },
  { value: "draft", label: "Borrador" },
  { value: "approved", label: "Aprobada" },
  { value: "sin", label: "Sin nota" },
]

export default async function ConsultasPage({
  searchParams,
}: {
  searchParams: Promise<{ orden?: string; q?: string; nota?: string }>
}) {
  const { orden, q, nota } = await searchParams
  const asc = orden === "asc" // por defecto: más recientes primero
  const query = (q ?? "").trim()
  const notaF = NOTA_FILTERS.some((f) => f.value === (nota ?? "")) ? (nota ?? "") : ""
  const filtering = Boolean(query || notaF)

  const supabase = await createClient()
  const { data } = await supabase
    .from("consultations")
    .select(
      "id, status, chief_complaint, started_at, patient:patients(id, name, species), notes:clinical_notes(id, status)"
    )
    .order("started_at", { ascending: false })
    .limit(200)
  const all = (data as unknown as ConsultationRow[] | null) ?? []

  // Filtro por estado de la nota (draft / approved / sin nota)
  const consultas = all.filter((c) => {
    if (!notaF) return true
    const st = c.notes?.[0]?.status
    return notaF === "sin" ? !st : st === notaF
  })

  // Agrupar por paciente (y filtrar por nombre); dentro, ordenar por fecha según el filtro.
  const groups = new Map<string, PatientGroup>()
  for (const c of consultas) {
    const name = c.patient?.name ?? "Sin paciente"
    if (query && !name.toLowerCase().includes(query.toLowerCase())) continue
    const pid = c.patient?.id ?? "—"
    const g = groups.get(pid) ?? {
      id: pid,
      name,
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
          <h1 className="text-lg font-semibold">Notas de consulta</h1>
        </div>
        <NewConsultationDrawer />
      </div>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Al cerrar una consulta, Athos redacta una nota SOAP con citas verificables de
        literatura veterinaria. Revísala, edítala y apruébala: ninguna nota entra a la
        historia clínica sin tu aprobación.
      </p>

      {/* Filtros: buscador por paciente · estado de la nota · orden por fecha */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <form action="/dashboard/consultas" className="relative">
          {asc && <input type="hidden" name="orden" value="asc" />}
          {notaF && <input type="hidden" name="nota" value={notaF} />}
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={query}
            placeholder="Buscar paciente…"
            className="h-8 w-56 pl-8"
            aria-label="Buscar paciente"
          />
        </form>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Nota:
          </span>
          {NOTA_FILTERS.map((f) => (
            <Link
              key={f.value || "todas"}
              href={hrefWith({ orden, q: query, nota: f.value })}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                notaF === f.value
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-secondary"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Fecha:
          </span>
          <Link
            href={hrefWith({ q: query, nota: notaF })}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              !asc
                ? "border-transparent bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-secondary"
            }`}
          >
            Más recientes
          </Link>
          <Link
            href={hrefWith({ orden: "asc", q: query, nota: notaF })}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              asc
                ? "border-transparent bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-secondary"
            }`}
          >
            Más antiguas
          </Link>
        </div>
      </div>

      {ordered.length === 0 && (
        <div className="rounded-xl border bg-card py-12 text-center text-sm text-muted-foreground">
          {filtering
            ? "Sin resultados con esos filtros."
            : "No hay consultas todavía. Crea una con “Nueva consulta” y el Phantom redactará la nota al cerrar."}
        </div>
      )}

      {/* Un desplegable por paciente con sus consultas */}
      <div className="flex flex-col gap-3">
        {ordered.map((g, gi) => (
          <details
            key={g.id}
            open={filtering || gi === 0}
            className="group rounded-xl border bg-card shadow-sm"
          >
            <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-sm font-bold">
                {g.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                {g.id !== "—" ? (
                  <Link
                    href={`/dashboard/patients/${g.id}`}
                    className="block w-fit max-w-full truncate text-sm font-semibold underline-offset-2 hover:underline"
                    title={`Abrir la ficha clínica de ${g.name}`}
                  >
                    {g.name}
                  </Link>
                ) : (
                  <span className="block truncate text-sm font-semibold">{g.name}</span>
                )}
                <span className="block text-xs text-muted-foreground">
                  {g.species || "—"} · última consulta{" "}
                  {fmtDate(new Date(g.latest).toISOString())}
                </span>
              </span>
              <Badge variant="secondary" className="shrink-0 text-xs">
                {g.consultas.length} {g.consultas.length === 1 ? "consulta" : "consultas"}
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
