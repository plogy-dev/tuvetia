"use client"

// Búsqueda + filtro por especie + tabla de pacientes, TODO client-side sobre el listado que ya
// vino del server. Antes la búsqueda navegaba con ?q= en cada tecla y re-corría las 5 queries del
// server component con un `q` que ni participaba en el SQL: tormenta de queries sin beneficio.

import { useMemo, useState } from "react"
import Link from "next/link"
import { FileTextIcon, PawPrintIcon, SearchIcon } from "lucide-react"

import { ExportCsvButton } from "@/components/export-csv-button"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { fmtAgeShort } from "@/lib/age"

export type PatientRow = {
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

function especieBucket(species: string): string {
  const s = (species || "").trim().toLowerCase()
  if (s.startsWith("perr")) return "perros"
  if (s.startsWith("gat")) return "gatos"
  return "otros"
}

export function PatientsExplorer({
  rows,
  listError,
  initialQuery = "",
}: {
  rows: PatientRow[]
  listError: boolean
  /** Sólo el valor INICIAL, del `?q=` del buscador global de la cabecera. Teclear sigue sin navegar
   *  ni re-consultar: la nota de arriba sobre la tormenta de queries sigue vigente. */
  initialQuery?: string
}) {
  const [q, setQ] = useState(initialQuery)
  const [especie, setEspecie] = useState("")

  const query = q.trim().toLowerCase()
  const patients = useMemo(
    () =>
      rows.filter((p) => {
        if (especie && especieBucket(p.species) !== especie) return false
        if (!query) return true
        return (
          p.name.toLowerCase().includes(query) ||
          (p.owner?.full_name ?? "").toLowerCase().includes(query) ||
          (p.owner?.phone ?? "").toLowerCase().includes(query)
        )
      }),
    [rows, query, especie],
  )

  return (
    <>
      {/* Búsqueda + filtro por especie (locales) + export de lo filtrado */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="relative w-full max-w-xs">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por mascota, titular o teléfono…"
            className="pl-8"
            aria-label="Buscar pacientes"
          />
        </div>
        <div className="flex items-center gap-1.5">
          {ESPECIE_FILTERS.map((f) => (
            <button
              key={f.value || "todos"}
              type="button"
              onClick={() => setEspecie(f.value)}
              className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
                especie === f.value
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "bg-background text-muted-foreground hover:bg-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <ExportCsvButton
          filename="pacientes.csv"
          headers={["Mascota", "Especie", "Raza", "Sexo", "Edad", "Titular", "Teléfono"]}
          rows={patients.map((p) => [
            p.name,
            p.species,
            p.breed ?? "",
            SEX_LABELS[p.sex] ?? p.sex,
            fmtAgeShort(p.birth_date),
            p.owner?.full_name ?? "",
            p.owner?.phone ?? "",
          ])}
        />
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
                  <TableCell className="font-mono text-xs">{fmtAgeShort(patient.birth_date)}</TableCell>
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
                  {listError
                    ? "No se pudieron cargar los pacientes. Recargá la página para reintentar."
                    : query || especie
                      ? "No se encontraron pacientes con esos filtros."
                      : "Todavía no hay pacientes registrados."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </>
  )
}
