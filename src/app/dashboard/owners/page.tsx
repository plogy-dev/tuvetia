import Link from "next/link"
import { UserRoundIcon } from "lucide-react"
import { CreateOwnerDrawer } from "@/components/create-owner-drawer"
import { RevokeConsentButton } from "@/components/owners/revoke-consent-button"
import { SearchBar } from "@/components/search-bar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { VistaPacientesTitulares } from "@/components/patients/vista-pacientes-titulares"
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
    <PageShell>
      {/* Esta pantalla no tenía encabezado: empezaba directamente en el buscador, sin decir
          siquiera en qué sección estabas ni cuántos titulares había. */}
      <PageHeader
        title="Titulares"
        description={`${owners?.length ?? 0} ${
          (owners?.length ?? 0) === 1 ? "titular" : "titulares"
        }${q ? ` que coinciden con «${q}»` : ""}`}
        actions={<CreateOwnerDrawer />}
      />
      <VistaPacientesTitulares activa="/dashboard/owners" />
      <div className="mb-4">
        <SearchBar defaultValue={q ?? ""} placeholder="Buscar titular..." />
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
                    {/* El nombre lleva a la ficha. Hasta ahora el listado era un callejón sin
                        salida: se veía el titular y no había a dónde ir. */}
                    <Link
                      href={`/dashboard/owners/${owner.id}`}
                      className="hover:underline"
                    >
                      {owner.full_name}
                    </Link>
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
                  {listError ? (
                    "No se pudieron cargar los titulares. Recarga la página para reintentar."
                  ) : q ? (
                    <>
                      Ningún titular se llama así.{" "}
                      <Link
                        href="/dashboard/owners"
                        className="font-medium text-foreground underline underline-offset-2"
                      >
                        Ver todos
                      </Link>
                      .
                    </>
                  ) : (
                    // El botón "Nuevo titular" está arriba, fuera del foco de quien está mirando la
                    // tabla vacía. Se repite acá, donde de verdad se está buscando la salida.
                    <div className="flex flex-col items-center gap-2">
                      <span>Todavía no hay titulares registrados.</span>
                      <CreateOwnerDrawer
                        label="Registrar el primer titular"
                        trigger={<Button variant="outline" size="sm" />}
                      />
                    </div>
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </PageShell>
  )
}
