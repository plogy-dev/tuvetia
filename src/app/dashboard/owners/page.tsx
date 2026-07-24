import { UserRoundIcon } from "lucide-react"
import { CreateOwnerDrawer } from "@/components/create-owner-drawer"
import { SearchBar } from "@/components/search-bar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { createClient } from "@/lib/supabase/server"

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

export default async function OwnersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from("owners")
    .select("id, full_name, phone, email, document_id")

  if (q) {
    query = query.ilike("full_name", `%${q}%`)
  }

  // Guarda de escala: listado acotado; con más titulares se busca por nombre (paginación real: backlog).
  const { data: owners } = await query.order("full_name").limit(200)

  return (
    <div className="flex flex-col gap-4 px-4 py-4 md:gap-6 md:py-6 lg:px-6">
      <div className="flex items-center justify-between gap-4">
        <SearchBar defaultValue={q ?? ""} placeholder="Buscar titular..." />
        <CreateOwnerDrawer />
      </div>
      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="w-14"></TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Documento</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {owners?.length ? (
              owners.map((owner) => (
                <TableRow key={owner.id}>
                  <TableCell>
                    <Avatar className="size-9">
                      <AvatarFallback>
                        {initials(owner.full_name) || (
                          <UserRoundIcon className="size-4" />
                        )}
                      </AvatarFallback>
                    </Avatar>
                  </TableCell>
                  <TableCell className="font-medium">
                    {owner.full_name}
                  </TableCell>
                  <TableCell>{owner.document_id ?? "—"}</TableCell>
                  <TableCell>{owner.phone ?? "—"}</TableCell>
                  <TableCell>{owner.email ?? "—"}</TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="h-24 text-center text-muted-foreground"
                >
                  {q
                    ? "No se encontraron titulares."
                    : "Todavía no hay titulares registrados."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
