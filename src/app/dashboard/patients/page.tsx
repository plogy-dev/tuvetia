import Link from "next/link"
import { FileTextIcon, PawPrintIcon, PlusIcon } from "lucide-react"

import { CreatePatientDrawer } from "@/components/create-patient-drawer"
import { ExportCsvButton } from "@/components/export-csv-button"
import { HelpTip } from "@/components/help-tip"
import { SearchBar } from "@/components/search-bar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/server"

const SEX_LABELS: Record<string, string> = {
  male: "Macho",
  female: "Hembra",
  unknown: "—",
}

const ESPECIE_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "Todos" },
  { value: "perros", label: "Perros" },
  { value: "gatos", label: "Gatos" },
  { value: "otros", label: "Otros" },
]

type PatientRow = {
  id: string
  name: string
  species: string
  breed: string | null
  sex: string
  birth_date: string | null
  photo_url: string | null
  // PostgREST devuelve el embed to-one (owner_id -> owners.id) como objeto,
  // pero el query builder no tipado lo infiere como arreglo.
  owner: { full_name: string; phone: string | null } | null
}

function especieBucket(species: string): string {
  const s = (species || "").trim().toLowerCase()
  if (s.startsWith("perr")) return "perros"
  if (s.startsWith("gat")) return "gatos"
  return "otros"
}

function fmtEdad(birth: string | null): string {
  if (!birth) return "—"
  const months =
    (Date.now() - new Date(birth).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
  if (months < 1) return "< 1 m"
  if (months < 12) return `${Math.floor(months)} m`
  return `${Math.floor(months / 12)} a`
}

// Límites del día y del mes en hora de Colombia (UTC-5, sin DST) para las métricas.
function bogotaBounds() {
  const BOG = 5 * 3600e3
  const bogNow = new Date(Date.now() - BOG)
  const dayStart = new Date(
    Date.UTC(bogNow.getUTCFullYear(), bogNow.getUTCMonth(), bogNow.getUTCDate()) + BOG
  )
  return {
    dayStart,
    dayEnd: new Date(dayStart.getTime() + 24 * 3600e3),
    monthStart: new Date(Date.UTC(bogNow.getUTCFullYear(), bogNow.getUTCMonth(), 1) + BOG),
  }
}

function hrefWith(p: { q?: string; especie?: string }): string {
  const sp = new URLSearchParams()
  if (p.q) sp.set("q", p.q)
  if (p.especie) sp.set("especie", p.especie)
  const s = sp.toString()
  return "/dashboard/patients" + (s ? `?${s}` : "")
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; especie?: string }>
}) {
  const { q, especie } = await searchParams
  const query = (q ?? "").trim().toLowerCase()
  const especieF = ESPECIE_FILTERS.some((f) => f.value === (especie ?? ""))
    ? (especie ?? "")
    : ""

  const supabase = await createClient()

  const { dayStart, dayEnd, monthStart } = bogotaBounds()

  // Guarda de escala: listado acotado; con más pacientes se busca por nombre (paginación real: backlog).
  const [{ data }, activos, citasHoy, enRevision, nuevosMes] = await Promise.all([
    supabase
      .from("patients")
      .select(
        "id, name, species, breed, sex, birth_date, photo_url, owner:owners(full_name, phone)"
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("patients").select("*", { count: "exact", head: true }),
    supabase
      .from("appointments")
      .select("*", { count: "exact", head: true })
      .gte("starts_at", dayStart.toISOString())
      .lt("starts_at", dayEnd.toISOString()),
    supabase
      .from("consultations")
      .select("*", { count: "exact", head: true })
      .eq("status", "review"),
    supabase
      .from("patients")
      .select("*", { count: "exact", head: true })
      .gte("created_at", monthStart.toISOString()),
  ])
  const all = (data as unknown as PatientRow[] | null) ?? []

  // Búsqueda por mascota, titular o teléfono + filtro por especie (sobre el listado acotado).
  const patients = all.filter((p) => {
    if (especieF && especieBucket(p.species) !== especieF) return false
    if (!query) return true
    return (
      p.name.toLowerCase().includes(query) ||
      (p.owner?.full_name ?? "").toLowerCase().includes(query) ||
      (p.owner?.phone ?? "").toLowerCase().includes(query)
    )
  })

  const metrics = [
    { n: activos.count ?? 0, l: "Pacientes activos" },
    { n: citasHoy.count ?? 0, l: "Citas hoy" },
    { n: enRevision.count ?? 0, l: "Consultas en revisión" },
    { n: nuevosMes.count ?? 0, l: "Nuevos del mes" },
  ]

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      {/* Encabezado + acciones */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold">Pacientes</h1>
            <HelpTip side="right">
              La ficha de cada paciente guarda su historia clínica completa: consultas con
              transcripción y audio, alergias, vacunas y medicación. Usa el botón{" "}
              <b>Historia</b> para verla.
            </HelpTip>
          </div>
          <p className="text-sm text-muted-foreground">
            {activos.count ?? 0} {(activos.count ?? 0) === 1 ? "paciente activo" : "pacientes activos"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportCsvButton
            filename="pacientes.csv"
            headers={["Mascota", "Especie", "Raza", "Sexo", "Edad", "Titular", "Teléfono"]}
            rows={patients.map((p) => [
              p.name,
              p.species,
              p.breed ?? "",
              SEX_LABELS[p.sex] ?? p.sex,
              fmtEdad(p.birth_date),
              p.owner?.full_name ?? "",
              p.owner?.phone ?? "",
            ])}
          />
          <CreatePatientDrawer
            label="Nuevo paciente"
            trigger={
              <Button size="sm">
                <PlusIcon className="size-4" />
              </Button>
            }
          />
        </div>
      </div>

      {/* Métricas */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.l} className="rounded-xl border bg-card p-4 shadow-sm">
            <div className="text-2xl font-semibold tracking-tight">{m.n}</div>
            <div className="text-xs text-muted-foreground">{m.l}</div>
          </div>
        ))}
      </div>

      {/* Búsqueda + filtro por especie */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <SearchBar
          defaultValue={q ?? ""}
          placeholder="Buscar por mascota, titular o teléfono…"
        />
        <div className="flex items-center gap-1.5">
          {ESPECIE_FILTERS.map((f) => (
            <Link
              key={f.value || "todos"}
              href={hrefWith({ q, especie: f.value })}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                especieF === f.value
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-secondary"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Tabla de pacientes */}
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Mascota</TableHead>
              <TableHead>Especie</TableHead>
              <TableHead className="hidden md:table-cell">Raza</TableHead>
              <TableHead>Sexo</TableHead>
              <TableHead>Edad</TableHead>
              <TableHead className="hidden sm:table-cell">Titular</TableHead>
              <TableHead className="hidden lg:table-cell">Teléfono</TableHead>
              <TableHead className="w-28 text-right">Historia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients.length ? (
              patients.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/patients/${patient.id}`}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <Avatar className="size-9">
                        <AvatarImage src={patient.photo_url ?? undefined} alt={patient.name} />
                        <AvatarFallback>
                          <PawPrintIcon className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      {patient.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-xs">
                      {patient.species}
                    </Badge>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    {patient.breed ?? "—"}
                  </TableCell>
                  <TableCell>{SEX_LABELS[patient.sex] ?? patient.sex}</TableCell>
                  <TableCell className="font-mono text-xs">{fmtEdad(patient.birth_date)}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {patient.owner?.full_name ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {patient.owner?.phone ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="outline"
                      size="sm"
                      render={<Link href={`/dashboard/patients/${patient.id}`} />}
                    >
                      <FileTextIcon className="size-3.5" /> Historia
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  {query || especieF
                    ? "No se encontraron pacientes con esos filtros."
                    : "Todavía no hay pacientes registrados."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
