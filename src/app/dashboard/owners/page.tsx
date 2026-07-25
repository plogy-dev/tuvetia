import { UserRoundIcon } from "lucide-react"
import { CreateOwnerDrawer } from "@/components/create-owner-drawer"
import { RevokeConsentButton } from "@/components/owners/revoke-consent-button"
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
  const { data: owners, error: listError } = await query.order("full_name").limit(200)

  // Titulares con consentimiento de grabación vigente (owner_scope, no revocado) -> muestran "Revocar".
  const { data: consentRows } = await supabase
    .from("consents")
    .select("owner_scope, revoked_at, patient:patients(owner_id)")
    .eq("owner_scope", true)
    .is("revoked_at", null)
  const consented = new Set(
    ((consentRows as { patient: { owner_id: string | null } | null }[] | null) ?? [])
      .map((c) => c.patient?.owner_id)
      .filter(Boolean) as string[],
  )

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
              <TableHead>Consentimiento</TableHead>
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
                  <TableCell>
                    {consented.has(owner.id) ? (
                      <span className="inline-flex items-center gap-1.5 text-xs">
                        <span className="text-muted-foreground">Grabación: vigente</span>
                        <RevokeConsentButton ownerId={owner.id} ownerName={owner.full_name} />
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="h-24 text-center text-muted-foreground"
                >
                  {listError
                    ? "No se pudieron cargar los titulares. Recargá la página para reintentar."
                    : q
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
