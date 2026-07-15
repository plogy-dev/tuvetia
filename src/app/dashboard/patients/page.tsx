import { PawPrintIcon } from "lucide-react"
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

  const { data } = await query.order("created_at", { ascending: false })
  const patients = data as unknown as PatientRow[] | null

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <SearchBar defaultValue={q ?? ""} placeholder="Buscar paciente..." />
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Mascota</TableHead>
              <TableHead>Especie</TableHead>
              <TableHead>Sexo</TableHead>
              <TableHead>Titular</TableHead>
              <TableHead>Teléfono</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {patients?.length ? (
              patients.map((patient) => (
                <TableRow key={patient.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-3">
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
                    </div>
                  </TableCell>
                  <TableCell>{patient.species}</TableCell>
                  <TableCell>
                    {SEX_LABELS[patient.sex] ?? patient.sex}
                  </TableCell>
                  <TableCell>{patient.owner?.full_name ?? "—"}</TableCell>
                  <TableCell>{patient.owner?.phone ?? "—"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
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
