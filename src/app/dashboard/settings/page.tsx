import Link from "next/link"
import { Building2, Clock, Download, Plug, User, Users } from "lucide-react"
import { Button } from "@/components/ui/button"

import { createClient } from "@/lib/supabase/server"
import { ProfileSettings } from "@/components/settings/profile-settings"
import { ClinicHoursSettings, type ClinicHourRow } from "@/components/settings/clinic-hours-settings"
import {
  TeamSettings,
  type PendingInvitation,
  type TeamMember,
} from "@/components/settings/team-settings"
import { HelpTip } from "@/components/help-tip"

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrador",
  vet: "Veterinario",
  assistant: "Asistente",
}

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

  const clinic = p?.clinic_id
    ? (await supabase.from("clinics").select("name").eq("id", p.clinic_id).single()).data
    : null
  const clinicName = (clinic as { name: string } | null)?.name ?? "—"

  // Sólo el estado, para el resumen: los formularios de conexión viven en /dashboard/conexiones.
  // (RLS: cada SELECT trae únicamente la fila de la clínica, y las credenciales están revocadas
  // para PostgREST.)
  const [{ data: wa }, { data: emailRow }] = await Promise.all([
    supabase.from("whatsapp_integrations").select("status").maybeSingle(),
    supabase.from("email_integrations").select("status").maybeSingle(),
  ])
  const waConnected = (wa as { status?: string } | null)?.status === "connected"
  const emailConnected = (emailRow as { status?: string } | null)?.status === "connected"

  // Horarios de atención (RLS de la clínica) — los usa Athos para citas y respuestas automáticas.
  const { data: hoursRows } = await supabase
    .from("clinic_hours")
    .select("id, weekday, opens_at, closes_at, slot_minutes")
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
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-4 md:py-6 lg:px-6">
      <h1 className="text-lg font-semibold">Configuración</h1>

      {/* Clínica (solo lectura) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <Building2 className="size-4 text-muted-foreground" /> Clínica
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Nombre</dt>
          <dd className="font-medium">{clinicName}</dd>
          <dt className="text-muted-foreground">Tu rol</dt>
          <dd>{p?.role ? (ROLE_LABELS[p.role] ?? p.role) : "—"}</dd>
        </dl>
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
          <Plug className="size-4 text-muted-foreground" /> Conexiones
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          WhatsApp {waConnected ? "conectado" : "sin conectar"} · Correo{" "}
          {emailConnected ? "conectado" : "sin conectar"}.
        </p>
        <Button variant="outline" render={<Link href="/dashboard/conexiones" />}>
          <Plug className="size-4" /> Ir a Conexiones
        </Button>
      </div>

      {/* Horarios de atención (los usa Athos: citas y respuestas automáticas) */}
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Clock className="size-4 text-muted-foreground" /> Horarios de atención
          <HelpTip>
            Athos usa estos horarios para proponer citas con cupos reales y para responder
            &quot;¿a qué hora abren?&quot; por WhatsApp. Sin horarios, no propone ni responde eso.
          </HelpTip>
        </div>
        <ClinicHoursSettings initialHours={(hoursRows as ClinicHourRow[] | null) ?? []} />
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
    </div>
  )
}
