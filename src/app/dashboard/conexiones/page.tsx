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

  const [{ data: wa }, { data: emailRow }, { data: cal }, correoAthos] = await Promise.all([
    supabase.from("whatsapp_integrations").select("status, phone_number, agent_mode").maybeSingle(),
    // Cuenta INSTITUCIONAL de la clínica: la que manda facturas y cobranza (user_id null).
    supabase
      .from("email_integrations")
      .select("status, from_email, from_name, last_error, verified_at")
      .is("user_id", null)
      .maybeSingle(),
    // El calendario es del usuario, no de la clínica: su propia fila, sea del proveedor que sea
    // (hay a lo sumo una — conectar el segundo exige desconectar el primero).
    user
      ? supabase
          .from("calendar_integrations")
          .select("provider")
          .eq("user_id", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // La cuenta de correo que este miembro conectó por Composio: la que usa Athos por él.
    user && composioListo
      ? estadoConexion(user.id)
      : Promise.resolve({ conectado: false, proveedor: null, email: null }),
  ])

  const waRow = wa as {
    status: "pending" | "connected" | "disconnected"
    phone_number: string | null
    agent_mode: "auto" | "review" | "paused" | "intervene"
  } | null
  const email = emailRow as EmailIntegrationView | null
  const calendarConnected = ((cal as { provider: string } | null)?.provider ?? null) as
    | CalendarProvider
    | null

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
              Es <b>tu</b> calendario, no el de la clínica: las citas donde figures como veterinario
              se crean ahí, invitando al titular. Elegí <b>Google</b> u <b>Outlook</b> — uno de los
              dos. Tuvetia solo <b>escribe</b> en tu calendario; nunca lee tus eventos.
            </HelpTip>
          </div>
          <p className="mb-3 text-sm text-fg-muted">
            {calendarConnected
              ? "Las citas que tengas asignadas aparecen en tu calendario, con el titular invitado."
              : "Conectá tu calendario para que las citas que tengas asignadas aparezcan ahí, con el titular invitado."}
          </p>
          <CalendarSettings connected={calendarConnected} />
        </section>
      </div>
    </PageShell>
  )
}
