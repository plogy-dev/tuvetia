import { PawPrintIcon } from "lucide-react"
import { PatientsSearch } from "@/components/patients-search"
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

  const { data: patients } = await query.order("created_at", {
    ascending: false,
  })

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <PatientsSearch defaultValue={q ?? ""} />
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="w-14"></TableHead>
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
                  <TableCell>
                    <Avatar className="size-9">
                      <AvatarImage
                        src={patient.photo_url ?? undefined}
                        alt={patient.name}
                      />
                      <AvatarFallback>
                        <PawPrintIcon className="size-4" />
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">
                    {patient.name}
                  </TableCell>
                  <TableCell>{patient.species}</TableCell>
                  <TableCell>
                    {SEX_LABELS[patient.sex] ?? patient.sex}
                  </TableCell>
                  <TableCell>{patient.owner?.[0]?.full_name ?? "—"}</TableCell>
                  <TableCell>{patient.owner?.[0]?.phone ?? "—"}</TableCell>
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
