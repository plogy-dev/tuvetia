import Link from "next/link"
import { Building2, Clock, Download, Plug, User, Users } from "lucide-react"
import { Button } from "@/components/ui/button"

import { createClient } from "@/lib/supabase/server"
import { ProfileSettings } from "@/components/settings/profile-settings"
import { DireccionDeLaClinica } from "@/components/settings/direccion-de-la-clinica"
import { ClinicHoursSettings, type ClinicHourRow } from "@/components/settings/clinic-hours-settings"
import {
  TeamSettings,
  type PendingInvitation,
  type TeamMember,
} from "@/components/settings/team-settings"
import { composioConfigurado, estadoConexion } from "@/lib/composio/correo"
import { HelpTip } from "@/components/help-tip"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
// Los rótulos de rol se mudaron a `lib/roles.ts`: el pie de la barra lateral también los usa ahora.
import { ROLES_LEGIBLES } from "@/lib/roles"

export const metadata = { title: "Configuración · Tuvetia" }



export default async function SettingsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("full_name, role, clinic_id")
          .eq("id", user.id)
          .single()
      ).data
    : null
  const p = profile as { full_name: string | null; role: string | null; clinic_id: string | null } | null

  // `address` y `city` viajan en la MISMA consulta que ya se hacía: la dirección se adjunta a cada
  // cita que se empuja al calendario, así que la clínica necesita poder cargarla desde acá.
  const clinic = p?.clinic_id
    ? (await supabase.from("clinics").select("name, address, city").eq("id", p.clinic_id).single()).data
    : null
  const c = clinic as { name: string; address: string | null; city: string | null } | null
  const clinicName = c?.name ?? "—"

  // Sólo el estado, para el resumen: los formularios de conexión viven en /dashboard/conexiones.
  // (RLS: cada SELECT trae únicamente la fila de la clínica, y las credenciales están revocadas
  // para PostgREST.)
  //
  // El correo se lee de Composio y no de `email_integrations`: esa tabla era de la cuenta SMTP
  // institucional, que se retiró — las facturas salen por el correo de Tuvetia y no hay nada que
  // conectar. Lo único conectable hoy es la cuenta personal desde la que Athos escribe, y es
  // por persona, así que el resumen habla de la de QUIEN MIRA, no de la clínica.
  const [{ data: wa }, correoAthos] = await Promise.all([
    supabase.from("whatsapp_integrations").select("status").maybeSingle(),
    user && composioConfigurado()
      ? estadoConexion(user.id)
      : Promise.resolve({ conectado: false, proveedor: null, email: null }),
  ])
  const waConnected = (wa as { status?: string } | null)?.status === "connected"

  // Horarios de atención (RLS de la clínica) — los usa Athos para citas y respuestas automáticas.
  // `vet_id` viaja porque desde la 0069 hay dos horarios en la misma tabla: el de la clínica
  // (nulo) y el de cada persona. La RLS de SELECT deja ver los dos — el de un compañero se lee
  // para poder agendar con él; lo que no se hace es escribirlo.
  const { data: hoursRows } = await supabase
    .from("clinic_hours")
    .select("id, weekday, opens_at, closes_at, slot_minutes, vet_id")
    .order("weekday")
    .order("opens_at")

  // Equipo: miembros de la clínica (RPC get_clinic_members: el email vive en auth.users, que
  // PostgREST no expone directo) + invitaciones pendientes (RLS: solo el admin las ve; para un
  // vet llega vacío).
  const isAdmin = p?.role === "admin"
  const { data: memberRows } = p?.clinic_id
    ? await supabase.rpc("get_clinic_members")
    : { data: null }
  const { data: inviteRows } = await supabase
    .from("invitations")
    .select("id, email, role, expires_at")
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
  const members = (memberRows as TeamMember[] | null) ?? []
  const pendingInvitations = (inviteRows as PendingInvitation[] | null) ?? []

  return (
    <PageShell width="narrow" className="flex flex-col gap-4">
      <PageHeader
        title="Configuración"
        description="Los datos de tu clínica, tu equipo y tus horarios de atención."
      />

      {/* Clínica. El nombre y el rol son de sólo lectura; la dirección se edita, porque es lo que
          sale en cada invitación de calendario y hasta ahora no había dónde cargarla. */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" /> Clínica
          <HelpTip>
            La <b>dirección</b> se adjunta a cada cita que se crea en el calendario: al titular le
            llega en la invitación y puede abrirla en el mapa. Sin ella, la invitación dice a qué
            hora pero no dónde.
          </HelpTip>
        </div>
        <dl className="mb-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Nombre</dt>
          <dd className="font-medium">{clinicName}</dd>
          <dt className="text-muted-foreground">Tu rol</dt>
          <dd>{p?.role ? (ROLES_LEGIBLES[p.role] ?? p.role) : "—"}</dd>
        </dl>
        {p?.clinic_id && (
          <DireccionDeLaClinica
            clinicId={p.clinic_id}
            initialAddress={c?.address ?? ""}
            initialCity={c?.city ?? ""}
            isAdmin={isAdmin}
          />
        )}
      </div>

      {/* Equipo de la clínica */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="size-4 text-muted-foreground" /> Equipo
          <HelpTip>
            Los miembros de tu clínica comparten pacientes, consultas y agenda. Solo un{" "}
            <b>administrador</b> puede invitar o revocar.
          </HelpTip>
        </div>
        <TeamSettings
          isAdmin={isAdmin}
          members={members}
          invitations={pendingInvitations}
          currentUserId={user?.id ?? ""}
        />
      </div>

      {/* Conexiones: WhatsApp y Correo se mudaron a su propia sección. Acá queda el estado y el
          enlace — repetir los mismos formularios en dos páginas sólo genera la duda de cuál manda. */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Plug className="size-4 text-muted-foreground" /> Integraciones
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          WhatsApp {waConnected ? "conectado" : "sin conectar"} · Correo de Athos{" "}
          {correoAthos.conectado ? "conectado" : "sin conectar"}.
        </p>
        <Button variant="outline" render={<Link href="/dashboard/conexiones" />}>
          <Plug className="size-4" /> Ir a Integraciones
        </Button>
      </div>

      {/* Horarios de atención (los usa Athos: citas y respuestas automáticas) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Clock className="size-4 text-muted-foreground" /> Horarios de atención
          <HelpTip>
            Athos usa estos horarios para proponer citas con cupos reales y para responder
            &quot;¿a qué hora abren?&quot; por WhatsApp. Sin horarios, no propone ni responde eso.
            Si tu horario no es el de la clínica, cargá el tuyo en <b>El mío</b>: reemplaza al de la
            clínica sólo en los días que definas, y sólo para vos.
          </HelpTip>
        </div>
        <ClinicHoursSettings
          initialHours={(hoursRows as ClinicHourRow[] | null) ?? []}
          vetId={user?.id ?? null}
        />
      </div>

      {/* Perfil (editable) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <User className="size-4 text-muted-foreground" /> Tu perfil
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          {user?.email ?? "—"}
        </p>
        {user && <ProfileSettings userId={user.id} initialName={p?.full_name ?? ""} />}
      </div>

      {/* Tus datos (export abierto — sin lock-in) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Download className="size-4 text-muted-foreground" /> Tus datos
          <HelpTip>
            Tus datos son tuyos: descargá en cualquier momento un archivo JSON (formato abierto) con
            pacientes, titulares, consultas, transcripciones, notas, citas y mensajes de tu clínica.
          </HelpTip>
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Exportá toda la información de tu clínica en formato abierto, cuando quieras.
        </p>
        <Button variant="outline" render={<a href="/api/export" download />}>
          <Download className="size-4" /> Exportar datos de la clínica
        </Button>
      </div>
    </PageShell>
  )
}
