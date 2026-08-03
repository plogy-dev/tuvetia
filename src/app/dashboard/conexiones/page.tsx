import { CalendarDays, Mail, MessageCircle } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { EmailSettings, type EmailIntegrationView } from "@/components/settings/email-settings"
import { WhatsappSettings } from "@/components/settings/whatsapp-settings"
import { CalendarSettings, type CalendarProvider } from "@/components/settings/calendar-settings"
import { AthosEmailSettings } from "@/components/settings/athos-email-settings"
import {
  avisoDeEntrega,
  composioConfigurado,
  estadoConexion,
  proveedoresDisponibles,
} from "@/lib/composio/correo"
import { estadoCalendario } from "@/lib/composio/calendario"
import { HelpTip } from "@/components/help-tip"
import { PageHeader, PageShell } from "@/components/ui/page-shell"

// Conexiones — la sección que el cliente separa de Configuración: acá vive todo lo que conecta a
// Tuvetia con el mundo de afuera. No duplica nada; son los mismos componentes que estaban en
// Configuración, que ahora apunta acá en vez de repetirlos.
//
// El calendario se conecta ACÁ y solo acá (calendario v3, migración 0049): es una decisión de cada
// usuario, explícita, eligiendo Google u Outlook. Antes se vinculaba solo al iniciar sesión y se
// gestionaba desde la página de Calendario.

export const dynamic = "force-dynamic"

export default async function ConexionesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const composioListo = composioConfigurado()

  const [{ data: wa }, { data: emailRow }, { data: cal }, correoAthos, calendarioAthos, { data: clinica }] =
    await Promise.all([
    supabase.from("whatsapp_integrations").select("status, phone_number, agent_mode").maybeSingle(),
    // Cuenta INSTITUCIONAL de la clínica: la que manda facturas y cobranza (user_id null).
    supabase
      .from("email_integrations")
      .select("status, from_email, from_name, last_error, verified_at")
      .is("user_id", null)
      .maybeSingle(),
    // Outlook Calendar todavía guarda su credencial acá. Google ya no: pasó a Composio, así que su
    // estado se le pregunta a quien tiene el token (ver abajo). Cuando Outlook también migre, esta
    // consulta y la tabla dejan de hacer falta.
    user
      ? supabase
          .from("calendar_integrations")
          .select("provider")
          .eq("user_id", user.id)
          .eq("provider", "microsoft")
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // La cuenta de correo que este miembro conectó por Composio: la que usa Athos por él.
    user && composioListo
      ? estadoConexion(user.id)
      : Promise.resolve({ conectado: false, proveedor: null, email: null }),
    // El calendario de Google, que ahora vive en Composio.
    user
      ? estadoCalendario(user.id)
      : Promise.resolve({ conectado: false, proveedor: null as "google" | null }),
    // ¿Quien mira es el administrador de la clínica? De eso depende que su calendario sea el que
    // recibe las citas — o que conectarlo no sirva de nada, que es peor no decirlo.
    user ? supabase.from("clinics").select("owner_id").maybeSingle() : Promise.resolve({ data: null }),
  ])

  const waRow = wa as {
    status: "pending" | "connected" | "disconnected"
    phone_number: string | null
    agent_mode: "auto" | "review" | "paused" | "intervene"
  } | null
  const email = emailRow as EmailIntegrationView | null
  // Un usuario tiene UN calendario. Google manda porque es el camino nuevo: si alguien quedó con
  // una fila vieja de Outlook y además conectó Google, lo que va a recibir las citas es Google.
  const esAdministrador =
    Boolean(user) && (clinica as { owner_id: string | null } | null)?.owner_id === user!.id
  const calendarConnected: CalendarProvider | null = calendarioAthos.conectado
    ? "google"
    : (((cal as { provider: string } | null)?.provider ?? null) as CalendarProvider | null)

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Conexiones"
        description="Los canales por los que Tuvetia habla con tus titulares y con tu agenda."
      />

      <div className="flex flex-col gap-4">
        <section className="rounded-lg border border-line-soft bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <MessageCircle className="size-4 text-fg-faint" aria-hidden /> WhatsApp
            <HelpTip>
              Cada clínica conecta <b>su propio</b> número escaneando un QR — sin compartir
              credenciales. Requiere la app <b>WhatsApp Business</b> (gratuita). Las conversaciones
              viven en la sección Comunicaciones.
            </HelpTip>
          </div>
          <WhatsappSettings
            initialStatus={waRow?.status ?? "none"}
            initialPhone={waRow?.phone_number ?? null}
            initialAgentMode={waRow?.agent_mode ?? "review"}
          />
        </section>

        <section className="rounded-lg border border-line-soft bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <Mail className="size-4 text-fg-faint" aria-hidden /> Correo de la clínica
            <HelpTip>
              La cuenta <b>institucional</b>: de acá salen las <b>facturas</b> con su enlace de pago
              y los recordatorios de cobranza. Una factura no sale a nombre de una persona. Se usa
              una <b>contraseña de aplicación</b> de Gmail, nunca la contraseña de la cuenta.
            </HelpTip>
          </div>
          <EmailSettings integration={email} />
        </section>

        <section className="rounded-lg border border-line-soft bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <Mail className="size-4 text-fg-faint" aria-hidden /> Correo de Athos
            <HelpTip>
              Es <b>tu</b> cuenta, no la de la clínica: cada miembro conecta la suya —<b>Gmail</b> u{" "}
              <b>Outlook</b>— y Athos usa la de quien le está pidiendo algo. Nunca escribe desde la
              cuenta de otro. Tuvetia no ve tu contraseña: la autorización la maneja el proveedor.
            </HelpTip>
          </div>
          <AthosEmailSettings
            conectado={correoAthos.conectado}
            proveedor={correoAthos.proveedor}
            email={correoAthos.email}
            disponibles={composioListo ? proveedoresDisponibles() : []}
            aviso={
              correoAthos.proveedor ? avisoDeEntrega(correoAthos.proveedor, correoAthos.email) : null
            }
          />
        </section>

        <section className="rounded-lg border border-line-soft bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <CalendarDays className="size-4 text-fg-faint" aria-hidden /> Calendario
            <HelpTip>
              Las citas de la clínica se crean en el calendario del <b>administrador</b>, y el
              titular y el veterinario asignado quedan <b>invitados</b> — como cuando te llega una
              invitación a una reunión. Tuvetia solo <b>escribe</b>; nunca lee tus eventos.
            </HelpTip>
          </div>
          <p className="mb-3 text-sm text-fg-muted">
            {esAdministrador
              ? calendarConnected
                ? "Las citas de la clínica se crean en tu calendario, con el titular y el veterinario invitados."
                : "Sos el administrador: conectá tu calendario para que las citas de la clínica se creen ahí, invitando al titular y al veterinario asignado."
              : "Las citas de la clínica se crean en el calendario del administrador. Cuando te asignen una, te llega la invitación por correo — no hace falta que conectes el tuyo."}
          </p>
          {esAdministrador && <CalendarSettings connected={calendarConnected} />}
        </section>
      </div>
    </PageShell>
  )
}
