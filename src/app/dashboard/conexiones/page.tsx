import { CalendarDays, Mail, MessageCircle } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { WhatsappSettings } from "@/components/settings/whatsapp-settings"
import { CalendarSettings, type CalendarProvider } from "@/components/settings/calendar-settings"
import { AthosEmailSettings } from "@/components/settings/athos-email-settings"
import {
  avisoDeEntrega,
  composioConfigurado,
  estadoConexion,
  proveedoresDisponibles,
} from "@/lib/composio/correo"
import { estadoCalendario, type EstadoCalendario } from "@/lib/composio/calendario"
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

  const [{ data: wa }, correoAthos, { data: clinica }] = await Promise.all([
    supabase.from("whatsapp_integrations").select("status, phone_number, agent_mode").maybeSingle(),
    // La cuenta de correo que este miembro conectó por Composio: la que usa Athos por él.
    user && composioListo
      ? estadoConexion(user.id)
      : Promise.resolve({ conectado: false, proveedor: null, email: null }),
    // De quién es el calendario de la clínica: su administrador. Con eso se resuelve tanto si quien
    // mira puede conectarlo como el estado que se le muestra.
    user ? supabase.from("clinics").select("owner_id").maybeSingle() : Promise.resolve({ data: null }),
  ])

  const administrador = (clinica as { owner_id: string | null } | null)?.owner_id ?? null
  const esAdministrador = Boolean(user && administrador && administrador === user.id)

  // El estado que importa es el del calendario DE LA CLÍNICA —el del administrador—, no el de quien
  // está mirando. Un veterinario que abre esta página necesita saber si las citas están llegando a
  // algún lado; su propia conexión no cambia nada desde que el evento vive en el del administrador.
  const calendarioClinica: EstadoCalendario = administrador
    ? await estadoCalendario(administrador)
    : { conectado: false, proveedor: null, compartidoConElCorreo: false }

  const waRow = wa as {
    status: "pending" | "connected" | "disconnected"
    phone_number: string | null
    agent_mode: "auto" | "review" | "paused" | "intervene"
  } | null
  const calendarConnected: CalendarProvider | null = calendarioClinica.proveedor

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

        {/* Acá vivía "Correo de la clínica", que pedía una contraseña de aplicación de Gmail para
            mandar por SMTP. Se quitó porque describía algo que ya no era cierto: las facturas y la
            cobranza salen por el correo de Tuvetia desde hace semanas (`lib/email/transactional.ts`),
            con el nombre de la clínica como remitente. La tarjeta seguía diciendo "Envío (SMTP)
            smtp.gmail.com · verificado", que era falso, y pedía una credencial que no se usaba para
            nada. En su lugar va una nota: no hay nada que conectar, y conviene decir por qué. */}
        <section className="rounded-lg border border-line-soft bg-card p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <Mail className="size-4 text-fg-faint" aria-hidden /> Facturas y cobranza
          </div>
          <p className="text-sm text-fg-muted">
            No hay nada que conectar. Las facturas y los recordatorios de pago salen por el correo de
            Tuvetia, <b>a nombre de tu clínica</b>, y si el titular responde, la respuesta le llega al
            administrador. Lo de abajo es distinto: es tu cuenta personal, para que Athos escriba
            <i> por vos</i>.
          </p>
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
              : calendarConnected
                ? "Las citas de la clínica se crean en el calendario del administrador. Cuando te asignen una, te llega la invitación por correo — no hace falta que conectes el tuyo."
                : "El administrador todavía no conectó el calendario de la clínica, así que las citas quedan sólo en Tuvetia y nadie recibe invitación. Pedile que lo conecte desde esta misma pantalla."}
          </p>
          {esAdministrador && (
            <CalendarSettings
              connected={calendarConnected}
              compartidoConElCorreo={calendarioClinica.compartidoConElCorreo}
            />
          )}
        </section>
      </div>
    </PageShell>
  )
}
