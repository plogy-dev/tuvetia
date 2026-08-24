import { requerirAdminDePlataforma } from "@/lib/platform-admin"
import { loadPlatformUsers } from "@/lib/admin/users"
import { platformEmailConfigurado } from "@/lib/email/platform-sender"
import { createClient } from "@/lib/supabase/server"
import { TOPE_ENVIO_MASIVO } from "@/lib/admin/limites"
import { DIAS_PARA_DORMIDA, ordenarPorRiesgo } from "@/lib/admin/riesgo"
import { ExportCsvButton } from "@/components/export-csv-button"
import { SendEmailDialog } from "@/components/admin/send-email-dialog"
import { ToggleActivacion } from "@/components/admin/toggle-activacion"
import { BulkEmailPanel } from "@/components/admin/bulk-email-panel"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export const metadata = { title: "Admin · Usuarios" }

// Las server actions de esta ruta heredan su límite de tiempo de este segmento. El envío masivo
// recorre destinatarios en serie con pausa entre uno y otro, así que necesita más que el default;
// mismo criterio que `api/cron/cartera`, que hace un barrido serial equivalente.
// 👤 Verificar que el plan de Vercel admita este valor: si lo recorta, hay que bajar
// TOPE_ENVIO_MASIVO en la misma proporción (`lib/admin/limites.ts`).
export const maxDuration = 120

const fecha = (iso: string | null) => (iso ? iso.slice(0, 10) : "—")

export default async function AdminUsuariosPage() {
  // ANTES DE CONSULTAR NADA: el layout no alcanza, la página se renderiza en paralelo y sus
  // datos se serializan en la respuesta aunque el layout devuelva 404. Ver `lib/platform-admin`.
  await requerirAdminDePlataforma()

  const { users: sinOrdenar, pending } = await loadPlatformUsers()
  const configurado = platformEmailConfigurado()

  // ORDENADA PARA REVISAR, no por fecha de alta. Con 17 cuentas da igual; con 300 el orden ES la
  // revisión, porque nadie baja hasta el final. Ver `lib/admin/riesgo.ts`, que también documenta
  // qué NO puede ver este puntaje.
  const users = ordenarPorRiesgo(sinOrdenar)

  // Quién está mirando. Sólo se usa para apagar el botón en su propia fila — el servidor lo vuelve
  // a comprobar en `cambiarActivacion`, porque una server action es un endpoint propio y esconder
  // un botón no protege nada.
  const {
    data: { user: admin },
  } = await (await createClient()).auth.getUser()

  const sinCorreo = users.filter((u) => !u.email).length
  const nuncaEntraron = users.filter((u) => u.nuncaEntro).length
  // `profiles.phone` está vacío en producción, así que "contactos" es en la práctica el correo.
  const conTelefono = users.filter((u) => u.phone).length

  const csvRows = users.map((u) => [
    u.fullName ?? "",
    u.email ?? "",
    u.phone ?? "",
    u.role ?? "",
    u.clinics.join(" | "),
    u.city ?? "",
    u.isActive === false ? "inactivo" : "activo",
    fecha(u.createdAt),
    u.lastSignInAt ? fecha(u.lastSignInAt) : "nunca",
  ])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Usuarios ({users.length})</h1>
          <p className="text-sm text-muted-foreground">
            Perfiles de <code>public.profiles</code> cruzados con el correo de <code>auth.users</code>{" "}
            y con <code>memberships</code> (todas sus clínicas, no sólo la activa).
            {conTelefono === 0 && " Ningún perfil tiene teléfono cargado: hoy el contacto es el correo."}
          </p>
          {/* EL ORDEN NO ES POR FECHA. Decirlo acá y no con una insignia por fila: las columnas ya
              muestran los hechos —"nunca" en último acceso, "—" en correo y en clínica— y repetirlos
              al lado del nombre sería decir lo mismo dos veces en la misma fila. Lo que hacía falta
              explicar era el criterio, no el dato. */}
          <p className="mt-1 text-xs text-muted-foreground">
            Ordenados <b className="font-medium text-foreground">por lo que conviene revisar antes</b>{" "}
            —nunca entró, sin clínica, sin correo, +{DIAS_PARA_DORMIDA} días sin entrar— y no por
            fecha de alta. Las desactivadas van al fondo. No mide consumo de IA: eso está en{" "}
            <code>/admin/uso</code>.
          </p>
        </div>
        <ExportCsvButton
          filename={`tuvetia-usuarios-${new Date().toISOString().slice(0, 10)}.csv`}
          headers={["Nombre", "Correo", "Teléfono", "Rol", "Clínicas", "Ciudad", "Estado", "Alta", "Último acceso"]}
          rows={csvRows}
        />
      </div>

      {/* Se despliega a lo ancho: cerrado es un botón, abierto es el compositor entero. */}
      <BulkEmailPanel
        candidatos={users
          .filter((u) => u.email && u.isActive !== false)
          .map((u) => ({ email: u.email!, nombre: u.fullName, clinica: u.activeClinic }))}
        configurado={configurado}
        tope={TOPE_ENVIO_MASIVO}
      />

      {!configurado && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft p-3 text-sm">
          <b>El envío de correos está deshabilitado.</b> Falta <code>RESEND_API_KEY</code> en Vercel.
          Además, antes del primer envío el dominio del remitente tiene que estar verificado en
          Resend (SPF y DKIM) — ver <code>CORREOS.md</code>.
        </div>
      )}

      {(sinCorreo > 0 || nuncaEntraron > 0) && (
        <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
          {nuncaEntraron > 0 && (
            <span>
              <b className="text-foreground">{nuncaEntraron}</b> se registraron y nunca entraron
            </span>
          )}
          {sinCorreo > 0 && (
            <span>
              <b className="text-foreground">{sinCorreo}</b> sin correo en <code>auth.users</code>{" "}
              (perfil huérfano)
            </span>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead>Usuario</TableHead>
              <TableHead>Correo</TableHead>
              <TableHead>Clínica(s)</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Alta</TableHead>
              <TableHead>Último acceso</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => (
              <TableRow key={u.id}>
                <TableCell>
                  <div className="font-medium">{u.fullName ?? "—"}</div>
                  {u.phone && <div className="text-xs text-muted-foreground">{u.phone}</div>}
                  {u.isActive === false && (
                    <Badge variant="outline" className="mt-1 text-[10px]">
                      inactivo
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{u.email ?? "—"}</TableCell>
                <TableCell>
                  {u.clinics.length === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {u.clinics.map((c) => (
                        <Badge
                          key={c}
                          variant={c === u.activeClinic ? "default" : "outline"}
                          className="text-[10px]"
                        >
                          {c}
                        </Badge>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{u.role ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{fecha(u.createdAt)}</TableCell>
                <TableCell className={u.nuncaEntro ? "text-warn dark:text-warn" : "text-muted-foreground"}>
                  {u.nuncaEntro ? "nunca" : fecha(u.lastSignInAt)}
                </TableCell>
                <TableCell className="relative">
                  <div className="flex items-center justify-end gap-0.5">
                    {u.email && (
                      <SendEmailDialog to={u.email} nombre={u.fullName} configurado={configurado} />
                    )}
                    <ToggleActivacion
                      userId={u.id}
                      nombre={u.fullName}
                      // `null` en la base cuenta como activa: la columna se agregó después de que
                      // existieran perfiles, y los viejos la tienen sin valor.
                      activo={u.isActive !== false}
                      esUnoMismo={u.id === admin?.id}
                    />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 text-sm font-semibold">Invitaciones sin aceptar ({pending.length})</div>
        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguna invitación pendiente.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {pending.map((p) => (
              <li key={`${p.clinic}-${p.email}`} className="flex items-center justify-between gap-2">
                <span className="min-w-0 flex-1 truncate">{p.email}</span>
                <span className="text-xs text-muted-foreground">
                  {p.clinic ?? "—"} · {p.role ?? "—"}
                </span>
                <Badge variant={p.vencida ? "outline" : "secondary"} className="text-[10px]">
                  {p.vencida ? "vencida" : `enviada ${fecha(p.createdAt)}`}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
