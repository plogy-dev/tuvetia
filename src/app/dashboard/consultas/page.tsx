import Link from "next/link"
import { ChevronDownIcon, ChevronRightIcon, GhostIcon, SearchIcon } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { FilterChip, FilterChips } from "@/components/ui/filter-chips"
import { Input } from "@/components/ui/input"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { createClient } from "@/lib/supabase/server"
import { bogotaDate } from "@/lib/date-utils"
import { DataError } from "@/components/data-error"
import { NewConsultationDrawer } from "@/components/new-consultation-drawer"
import { FormularioDeFiltros } from "@/components/ui/formulario-de-filtros"
import { tituloDeLaConsulta } from "@/lib/consultas/titulo"

export const metadata = { title: "Modo Fantasma · Tuvetia" }


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
  // `assessment` y `subjective` son para TITULAR la consulta cuando no hay motivo escrito a mano:
  // ver `lib/consultas/titulo.ts`. No se muestran acá, sólo alimentan el título.
  notes: { id: string; status: string; assessment: string | null; subjective: string | null }[] | null
}

type PatientGroup = {
  id: string
  name: string
  species: string
  consultas: ConsultationRow[]
  latest: number
}

// Anclada a America/Bogota: este es un server component y el runtime de Vercel es UTC, así que sin
// `timeZone` una consulta de las 19:00 se mostraba con la fecha del día siguiente.
const fmtDate = bogotaDate

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
  const { data, error: listError } = await supabase
    .from("consultations")
    .select(
      // `assessment` y `subjective` vienen para poder titular la consulta desde la nota cuando no
      // hay motivo escrito: son dos columnas de una tabla que ya se estaba trayendo.
      "id, status, chief_complaint, started_at, patient:patients(id, name, species), notes:clinical_notes(id, status, assessment, subjective)"
    )
    .order("started_at", { ascending: false })
    // notes[0] debe ser la nota MÁS RECIENTE: sin esto, PostgREST no garantiza orden y una
    // consulta con nota vieja draft + nueva aprobada podría mostrarse como "Borrador".
    .order("created_at", { referencedTable: "notes", ascending: false })
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
    <PageShell>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2">
            <GhostIcon className="size-5 text-fg-faint" aria-hidden />
            Modo Fantasma
          </span>
        }
        description="Al cerrar una consulta, Athos redacta una nota SOAP con citas verificables de literatura veterinaria. Revísala, edítala y apruébala: ninguna nota entra a la historia clínica sin tu aprobación."
        actions={<NewConsultationDrawer />}
      />

      {/* Filtros: buscador por paciente · estado de la nota · orden por fecha */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {/* NAVEGA POR EL CLIENTE. Un `<form method="get">` nativo recarga el documento, y esta es
            LA PANTALLA DEL MODO FANTASMA: buscar una consulta anterior mientras se graba mataba la
            grabación con el aviso de «¿salir del sitio?». Ver `lib/busqueda-en-la-url.ts`. */}
        <FormularioDeFiltros action="/dashboard/consultas" className="relative">
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
        </FormularioDeFiltros>

        <FilterChips label="Nota:">
          {NOTA_FILTERS.map((f) => (
            <FilterChip
              key={f.value || "todas"}
              href={hrefWith({ orden, q: query, nota: f.value })}
              active={notaF === f.value}
            >
              {f.label}
            </FilterChip>
          ))}
        </FilterChips>

        <FilterChips label="Fecha:">
          <FilterChip href={hrefWith({ q: query, nota: notaF })} active={!asc}>
            Más recientes
          </FilterChip>
          <FilterChip href={hrefWith({ orden: "asc", q: query, nota: notaF })} active={asc}>
            Más antiguas
          </FilterChip>
        </FilterChips>
      </div>

      {listError && <DataError />}
      {!listError &&
        ordered.length === 0 &&
        (filtering ? (
          <EmptyState
            icon={<SearchIcon />}
            title="Sin resultados con esos filtros"
            description="Prueba con otro nombre de paciente, o quita los filtros para ver todas las consultas."
            action={
              <Button variant="outline" render={<Link href="/dashboard/consultas" />}>
                Quitar los filtros
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<GhostIcon />}
            title="Todavía no hay consultas"
            description="Empieza una y el Modo Fantasma redactará la nota SOAP al cerrarla, con literatura veterinaria citada."
            action={<NewConsultationDrawer label="Iniciar la primera consulta" />}
          />
        ))}

      {/* Un desplegable por paciente con sus consultas */}
      <div className="flex flex-col gap-3">
        {ordered.map((g, gi) => (
          <details
            key={g.id}
            open={filtering || gi === 0}
            className="group rounded-xl border bg-card"
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
                      {tituloDeLaConsulta({
                        chiefComplaint: c.chief_complaint,
                        assessment: note?.assessment,
                        subjective: note?.subjective,
                      })}
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
    </PageShell>
  )
}
