import Link from "next/link"
import { CalendarDays, Mail, MessageCircle } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { EmailSettings, type EmailIntegrationView } from "@/components/settings/email-settings"
import { WhatsappSettings } from "@/components/settings/whatsapp-settings"
import { HelpTip } from "@/components/help-tip"
import { Button } from "@/components/ui/button"
import { PageHeader, PageShell } from "@/components/ui/page-shell"

// Conexiones — la sección que el cliente separa de Configuración: acá vive todo lo que conecta a
// Tuvetia con el mundo de afuera. No duplica nada; son los mismos componentes que estaban en
// Configuración, que ahora apunta acá en vez de repetirlos.
//
// La tarjeta de Google Calendar es de SÓLO LECTURA a propósito. `GoogleCalendarConnect` dispara un
// pull automático al montar, y `dashboard/calendario/page.tsx` documenta un incidente de producción
// del 2026-07-31 en el que ese pull insertó 1.567 citas espurias del calendario personal del vet.
// Montarlo también acá sería repetir el pull en una segunda página. Hasta que se resuelva qué
// calendario de Google se sincroniza, la gestión se queda en Calendario y acá sólo se informa.

export const dynamic = "force-dynamic"

export default async function ConexionesPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [{ data: wa }, { data: emailRow }, { data: cal }] = await Promise.all([
    supabase.from("whatsapp_integrations").select("status, phone_number, agent_mode").maybeSingle(),
    supabase
      .from("email_integrations")
      .select("status, from_email, from_name, last_error, verified_at")
      .maybeSingle(),
    user
      ? supabase
          .from("calendar_integrations")
          .select("id, connected_at")
          .eq("user_id", user.id)
          .eq("provider", "google")
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  const waRow = wa as {
    status: "pending" | "connected" | "disconnected"
    phone_number: string | null
    agent_mode: "auto" | "review" | "paused" | "intervene"
  } | null
  const email = emailRow as EmailIntegrationView | null
  const googleConnected = Boolean(cal)

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
            <Mail className="size-4 text-fg-faint" aria-hidden /> Correo
            <HelpTip>
              Con el correo conectado, las <b>facturas</b> salen por email con su enlace de pago. Se
              usa una <b>contraseña de aplicación</b> de Gmail, nunca la contraseña de la cuenta.
            </HelpTip>
          </div>
          <EmailSettings integration={email} />
        </section>

        <section className="rounded-lg border border-line-soft bg-card p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <CalendarDays className="size-4 text-fg-faint" aria-hidden /> Google Calendar
          </div>
          <p className="mb-3 text-sm text-fg-muted">
            {googleConnected
              ? "Tu cuenta de Google está conectada. La sincronización se gestiona desde el Calendario, junto a las citas que afecta."
              : "Todavía no has conectado Google Calendar. Se conecta desde el Calendario, junto a las citas que afecta."}
          </p>
          <Button variant="outline" render={<Link href="/dashboard/calendario" />}>
            <CalendarDays className="size-4" aria-hidden />
            {googleConnected ? "Gestionar en Calendario" : "Conectar desde Calendario"}
          </Button>
        </section>
      </div>
    </PageShell>
  )
}
