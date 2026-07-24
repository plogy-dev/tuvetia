import Link from "next/link"
import { ChevronRightIcon, PawPrintIcon } from "lucide-react"
import { HelpTip } from "@/components/help-tip"
import { SearchBar } from "@/components/search-bar"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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
  unknown: "Desconocido",
}

type PatientRow = {
  id: string
  name: string
  species: string
  sex: string
  photo_url: string | null
  // PostgREST returns a to-one embed (owner_id -> owners.id) as a single
  // object, but the untyped query builder infers it as an array.
  owner: { full_name: string; phone: string | null } | null
}

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from("patients")
    .select("id, name, species, sex, photo_url, owner:owners(full_name, phone)")

  if (q) {
    query = query.ilike("name", `%${q}%`)
  }

  // Guarda de escala: listado acotado; con más pacientes se busca por nombre (paginación real: backlog).
  const { data } = await query.order("created_at", { ascending: false }).limit(200)
  const patients = data as unknown as PatientRow[] | null

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex items-center gap-2">
        <SearchBar defaultValue={q ?? ""} placeholder="Buscar paciente..." />
        <HelpTip side="right">
          La ficha de cada paciente guarda su historia clínica completa: consultas con transcripción y
          audio, alergias, vacunas y medicación. Hacé clic en un paciente para verla.
        </HelpTip>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Mascota</TableHead>
              <TableHead>Especie</TableHead>
              <TableHead>Sexo</TableHead>
              <TableHead>Titular</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead className="w-16 text-right">Historia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients?.length ? (
              patients.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/patients/${patient.id}`}
                      className="flex items-center gap-3 hover:underline"
                    >
                      <Avatar className="size-9">
                        <AvatarImage
                          src={patient.photo_url ?? undefined}
                          alt={patient.name}
                        />
                        <AvatarFallback>
                          <PawPrintIcon className="size-4" />
                        </AvatarFallback>
                      </Avatar>
                      {patient.name}
                    </Link>
                  </TableCell>
                  <TableCell>{patient.species}</TableCell>
                  <TableCell>
                    {SEX_LABELS[patient.sex] ?? patient.sex}
                  </TableCell>
                  <TableCell>{patient.owner?.full_name ?? "—"}</TableCell>
                  <TableCell>{patient.owner?.phone ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/patients/${patient.id}`}
                      className="inline-flex items-center justify-end text-primary hover:underline"
                      aria-label={`Ver historia de ${patient.name}`}
                    >
                      <ChevronRightIcon className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  {q
                    ? "No se encontraron pacientes."
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
