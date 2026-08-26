import Link from "next/link"
import { Building2, CalendarClock, Clock, Download, Plug, User, Users } from "lucide-react"

import { Button } from "@/components/ui/button"
import { sesionDelServidor } from "@/lib/supabase/sesion"
import { ProfileSettings } from "@/components/settings/profile-settings"
import { DireccionDeLaClinica } from "@/components/settings/direccion-de-la-clinica"
import { ClinicHoursSettings, type ClinicHourRow } from "@/components/settings/clinic-hours-settings"
import { RecordatorioCitasSettings } from "@/components/settings/recordatorio-citas-settings"
import {
  TeamSettings,
  type PendingInvitation,
  type TeamMember,
} from "@/components/settings/team-settings"
import { composioConfigurado, estadoConexion } from "@/lib/composio/correo"
import { HelpTip } from "@/components/help-tip"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { TabNav, TabNavLink } from "@/components/ui/tab-nav"
import { ROLES_LEGIBLES } from "@/lib/roles"

export const metadata = { title: "Configuración de la veterinaria · Tuvetia" }

// La configuración de la clínica, en pestañas, como la tiene OkVet.
//
// ── ES UNA MUDANZA, NO UNA REESCRITURA ────────────────────────────────────────────────────────
//
// Todo lo de acá vivía en `/dashboard/settings` y son los MISMOS componentes con las MISMAS
// acciones de servidor. Lo único que cambia es que dejan de estar apilados en una tira de 236
// líneas y quedan agrupados por lo que uno viene a hacer.
//
// `/dashboard/settings` sigue respondiendo: redirige acá conservando la query. Importa porque el
// callback de WhatsApp vuelve a `?whatsapp=connected` y hay enlaces compartidos por fuera del
// código que no podemos repuntar.
//
// ── LAS PESTAÑAS SON URLs, NO ESTADO ──────────────────────────────────────────────────────────
//
// Por eso `TabNav` y no `ui/tabs.tsx`: el riel de onboarding manda a «Horarios de atención», y un
// enlace que abre la página en la pestaña equivocada deja al vet buscando el ajuste que le
// prometieron. Con `?tab=agenda` el enlace aterriza donde dice.

const PESTANAS = [
  { id: "general", label: "Clínica" },
  { id: "equipo", label: "Usuarios y equipo" },
  { id: "agenda", label: "Agenda y recordatorios" },
  { id: "cuenta", label: "Tu cuenta" },
] as const

type PestanaId = (typeof PESTANAS)[number]["id"]

export default async function ConfiguracionDeLaClinicaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab } = await searchParams
  // Una pestaña inventada cae en la primera y no en una pantalla en blanco.
  const activa: PestanaId = PESTANAS.some((p) => p.id === tab) ? (tab as PestanaId) : "general"

  const { supabase, user } = await sesionDelServidor()

  const profile = user
    ? (
        await supabase
          .from("profiles")
          .select("full_name, role, clinic_id")
          .eq("id", user.id)
          .single()
      ).data
    : null
  const p = profile as {
    full_name: string | null
    role: string | null
    clinic_id: string | null
  } | null
  const isAdmin = p?.role === "admin"

  const clinic = p?.clinic_id
    ? (
        await supabase
          .from("clinics")
          .select(
            "name, address, city, recordatorio_citas_activo, recordatorio_citas_horas, recordatorio_citas_texto",
          )
          .eq("id", p.clinic_id)
          .single()
      ).data
    : null
  const c = clinic as {
    name: string
    address: string | null
    city: string | null
    recordatorio_citas_activo: boolean
    recordatorio_citas_horas: number
    recordatorio_citas_texto: string | null
  } | null

  // Cada pestaña pide SÓLO lo suyo. Antes esta pantalla hacía las cinco consultas siempre, porque
  // pintaba las cinco secciones; ahora abrir «Tu cuenta» no tiene por qué traer el equipo entero.
  const [wa, correoAthos, hoursRows, memberRows, inviteRows] = await Promise.all([
    activa === "cuenta"
      ? supabase.from("whatsapp_integrations").select("status").maybeSingle()
      : Promise.resolve({ data: null }),
    activa === "cuenta" && user && composioConfigurado()
      ? estadoConexion(user.id)
      : Promise.resolve({ conectado: false, proveedor: null, email: null }),
    activa === "agenda"
      ? supabase
          .from("clinic_hours")
          .select("id, weekday, opens_at, closes_at, slot_minutes, vet_id")
          .order("weekday")
          .order("opens_at")
      : Promise.resolve({ data: null }),
    activa === "equipo" && p?.clinic_id
      ? supabase.rpc("get_clinic_members")
      : Promise.resolve({ data: null }),
    activa === "equipo"
      ? supabase
          .from("invitations")
          .select("id, email, role, expires_at")
          .is("accepted_at", null)
          .gt("expires_at", new Date().toISOString())
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: null }),
  ])
  const waConnected = (wa.data as { status?: string } | null)?.status === "connected"

  return (
    <PageShell width="narrow" className="flex flex-col gap-4">
      <PageHeader
        title="Configuración de la veterinaria"
        description="Los datos de tu clínica, tu equipo y tus horarios de atención."
      />

      <TabNav>
        {PESTANAS.map((t) => (
          <TabNavLink
            key={t.id}
            href={"/dashboard/administracion/clinica?tab=" + t.id}
            active={t.id === activa}
          >
            {t.label}
          </TabNavLink>
        ))}
      </TabNav>

      {activa === "general" && (
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
            <dd className="font-medium">{c?.name ?? "—"}</dd>
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
      )}

      {activa === "equipo" && (
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
            members={(memberRows.data as TeamMember[] | null) ?? []}
            invitations={(inviteRows.data as PendingInvitation[] | null) ?? []}
            currentUserId={user?.id ?? ""}
          />
        </div>
      )}

      {activa === "agenda" && (
        <>
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Clock className="size-4 text-muted-foreground" /> Horarios de atención
              <HelpTip>
                VetGPT usa estos horarios para proponer citas con cupos reales y para responder
                &quot;¿a qué hora abren?&quot; por WhatsApp. Sin horarios, no propone ni responde
                eso. Si tu horario no es el de la clínica, cargá el tuyo en <b>El mío</b>: reemplaza
                al de la clínica sólo en los días que definas, y sólo para vos.
              </HelpTip>
            </div>
            <ClinicHoursSettings
              initialHours={(hoursRows.data as ClinicHourRow[] | null) ?? []}
              vetId={user?.id ?? null}
            />
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CalendarClock className="size-4 text-muted-foreground" /> Recordatorio de citas
              <HelpTip>
                Le escribe al titular por WhatsApp antes de su cita. Sale del número de la clínica y
                necesita WhatsApp conectado. Arranca apagado: encenderlo es decidir que la clínica
                le habla sola a sus clientes.
              </HelpTip>
            </div>
            <RecordatorioCitasSettings
              activoInicial={c?.recordatorio_citas_activo ?? false}
              horasIniciales={c?.recordatorio_citas_horas ?? 24}
              textoInicial={c?.recordatorio_citas_texto ?? null}
              puedeEditar={isAdmin}
            />
          </div>
        </>
      )}

      {activa === "cuenta" && (
        <>
          <div className="rounded-xl border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <User className="size-4 text-muted-foreground" /> Tu perfil
            </div>
            <p className="mb-3 text-sm text-muted-foreground">{user?.email ?? "—"}</p>
            {user && <ProfileSettings userId={user.id} initialName={p?.full_name ?? ""} />}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Plug className="size-4 text-muted-foreground" /> Integraciones
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              WhatsApp {waConnected ? "conectado" : "sin conectar"} · Correo de VetGPT{" "}
              {correoAthos.conectado ? "conectado" : "sin conectar"}.
            </p>
            <Button variant="outline" render={<Link href="/dashboard/conexiones" />}>
              <Plug className="size-4" /> Ir a Integraciones
            </Button>
          </div>

          <div className="rounded-xl border bg-card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <Download className="size-4 text-muted-foreground" /> Tus datos
              <HelpTip>
                Tus datos son tuyos: descargá en cualquier momento un archivo JSON (formato abierto)
                con pacientes, titulares, consultas, transcripciones, notas, citas y mensajes de tu
                clínica.
              </HelpTip>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">
              Exportá toda la información de tu clínica en formato abierto, cuando quieras.
            </p>
            <Button variant="outline" render={<a href="/api/export" download />}>
              <Download className="size-4" /> Exportar datos de la clínica
            </Button>
          </div>
        </>
      )}
    </PageShell>
  )
}
