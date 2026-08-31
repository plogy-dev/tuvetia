import { CalendarDays, Mail, MessageCircle } from "lucide-react"

import { sesionDelServidor } from "@/lib/supabase/sesion"
import { WhatsappSettings } from "@/components/settings/whatsapp-settings"
import { cupoDeHoy } from "@/lib/whatsapp/rampa"
import { requisitosDelModoAutomatico } from "@/lib/whatsapp/requisitos-del-modo-automatico"
import { VetgptNoRespondeSolo } from "@/components/conexiones/vetgpt-no-responde-solo"
import { CalendarSettings, type CalendarProvider } from "@/components/settings/calendar-settings"
import { AthosEmailSettings } from "@/components/settings/athos-email-settings"
import {
  avisoDeEntrega,
  composioConfigurado,
  estadoConexion,
  proveedoresDisponibles,
} from "@/lib/composio/correo"
import { estadoCalendario, type EstadoCalendario } from "@/lib/composio/calendario"
import {
  esElAdministradorDelCalendario,
  quienTieneElCalendario,
  type PerfilCandidato,
} from "@/lib/calendario/quien-lo-tiene"
import { HelpTip } from "@/components/help-tip"
import { PageHeader, PageShell } from "@/components/ui/page-shell"

export const metadata = { title: "Integraciones · Tuvetia" }


// Conexiones — la sección que el cliente separa de Configuración: acá vive todo lo que conecta a
// Tuvetia con el mundo de afuera. No duplica nada; son los mismos componentes que estaban en
// Configuración, que ahora apunta acá en vez de repetirlos.
//
// El calendario se conecta ACÁ (migración 0049): es una decisión de cada usuario, explícita,
// eligiendo Google u Outlook. Antes se vinculaba solo al iniciar sesión.
//
// LO CONECTAN LOS DOS ROLES (v5). Hasta v4 el formulario sólo se le mostraba al administrador,
// porque el evento vivía en su calendario y conectar el propio no le cambiaba nada a nadie más.
// Ahora el evento se crea en el del VETERINARIO ASIGNADO, así que conectar el suyo es lo que hace
// que su agenda de Tuvetia aparezca en su teléfono. La agenda además se lo pide con una ventana a
// quien entra sin conectar (`AvisoConectarCalendario`): acá se hace a propósito, allá se resuelve
// donde se nota que falta.

export const dynamic = "force-dynamic"

export default async function ConexionesPage() {
  const { supabase, user } = await sesionDelServidor()

  const composioListo = composioConfigurado()

  const SIN_CALENDARIO: EstadoCalendario = {
    conectado: false,
    proveedor: null,
    compartidoConElCorreo: false,
  }

  const [
    { data: wa },
    correoAthos,
    { data: clinica },
    { data: adminDeRespaldo },
    miCalendario,
    { count: horariosCargados },
  ] = await Promise.all([
    supabase
      .from("whatsapp_integrations")
      // `connected_at` y `auto_daily_limit` alimentan la línea de la rampa en la barra de
      // autonomía — la parte «se gana con el uso» que ya existía muda en auto-reply.ts.
      .select("status, phone_number, agent_mode, connected_at, auto_daily_limit")
      .maybeSingle(),
    // La cuenta de correo que este miembro conectó por Composio: la que usa VetGPT por él.
    user && composioListo
      ? estadoConexion(user.id)
      : Promise.resolve({ conectado: false, proveedor: null, email: null }),
    // Quién administra la clínica: es el anfitrión de respaldo cuando el vet asignado no conectó el
    // suyo, y lo que hace falta para decirle a un vet a dónde están yendo sus citas mientras tanto.
    user
      ? supabase.from("clinics").select("owner_id, plan").maybeSingle()
      : Promise.resolve({ data: null }),
    // EL RESPALDO, y el nombre. Se pide siempre —no sólo cuando falta `owner_id`— porque también
    // sirve para NOMBRAR al administrador más abajo, y una consulta más en la misma ola no cuesta
    // una ida y vuelta.
    user
      ? supabase.from("profiles").select("id, full_name").eq("role", "admin").limit(1).maybeSingle()
      : Promise.resolve({ data: null }),
    // EL ESTADO QUE IMPORTA ES EL DE QUIEN MIRA (v5). Hasta v4 acá se consultaba el del
    // administrador, porque el evento vivía en su calendario y la conexión de quien miraba no
    // cambiaba nada. Ahora es al revés: el evento se crea en el del vet asignado.
    user && composioListo ? estadoCalendario(user.id) : Promise.resolve(SIN_CALENDARIO),
    // ¿LA CLÍNICA CARGÓ SUS HORARIOS? Alimenta el aviso de la barra de autonomía. `head: true`: no
    // se traen filas, sólo el conteo. `vet_id` nulo = el horario de la puerta, que es el que VetGPT
    // le ofrece a un titular (0069) — el personal de un vet no sirve para eso.
    user
      ? supabase
          .from("clinic_hours")
          .select("id", { count: "exact", head: true })
          .is("vet_id", null)
      : Promise.resolve({ count: 0 }),
  ])

  // UNA SOLA REGLA para "de quién es el calendario", compartida con el camino que empuja la cita
  // (`composio/calendario.ts`). Acá usaba sólo `owner_id`, y en una clínica sin él eso dejaba al
  // primer `admin` recibiendo las citas en un calendario que nunca podía conectar.
  const administrador = quienTieneElCalendario(
    (clinica as { owner_id: string | null } | null)?.owner_id,
    adminDeRespaldo as PerfilCandidato | null,
  )
  const esAdministrador = esElAdministradorDelCalendario(user?.id, administrador)

  // Cómo se llama, para poder decirlo. Sólo se sabe si el administrador resultó ser el perfil que
  // trajimos; si no, la frase cae a "el administrador" a secas, que es lo que decía antes.
  const nombreDelAdministrador =
    administrador && (adminDeRespaldo as PerfilCandidato | null)?.id === administrador
      ? ((adminDeRespaldo as PerfilCandidato).full_name ?? null)
      : null

  // El del administrador se consulta SÓLO si hace falta para decir algo que no se sabe ya: si quien
  // mira es el administrador, su estado es el mismo que se acaba de traer; y si ya conectó el suyo,
  // el respaldo no entra en juego. Cada una de estas es un viaje por red a Composio.
  const calendarioDeRespaldo: EstadoCalendario =
    administrador && !esAdministrador && !miCalendario.conectado && composioListo
      ? await estadoCalendario(administrador)
      : SIN_CALENDARIO

  const waRow = wa as {
    status: "pending" | "connected" | "disconnected"
    phone_number: string | null
    agent_mode: "auto" | "review" | "paused" | "intervene"
    connected_at: string | null
    auto_daily_limit: number | null
  } | null
  // El cupo se cuenta ACÁ, en el servidor, con la función pura de la rampa — el reloj dentro
  // del render es impuro (mismo criterio que `diasDePruebaRestantes` en la página del plan).
  const cupoAutoDeHoy = cupoDeHoy(waRow?.connected_at ?? null, waRow?.auto_daily_limit ?? null)

  // ── EL CHECKLIST QUE EXISTÍA Y NO CONSUMÍA NADIE ────────────────────────────────────────────
  //
  // `requisitos-del-modo-automatico.ts` está escrito y probado desde el 27-ago —cuando David
  // encendió el interruptor y «no pasó nada»— y hasta hoy no lo importaba ni un archivo. El precio
  // se pagó el 30-ago: una clínica encendió el modo automático con cero horarios cargados y se
  // enteró por un cliente que se quedó esperando.
  const requisitosDelAuto = requisitosDelModoAutomatico({
    conectado: waRow?.status === "connected",
    // El plan viaja en la misma consulta que trae al administrador: una columna más, cero viajes más.
    planPro: (clinica as { plan?: string } | null)?.plan === "pro",
    esAdmin: esAdministrador,
    tieneHorarios: (horariosCargados ?? 0) > 0,
  })
  const calendarConnected: CalendarProvider | null = miCalendario.proveedor

  return (
    <PageShell width="narrow">
      {/* Primera visita: VetGPT no responde solo. La respuesta a la pregunta más importante de
          esta pantalla, ANTES de la decisión de conectar — pedido de Felipe del 26-ago: «un
          veterinario no es técnico». */}
      <VetgptNoRespondeSolo />
      <PageHeader
        title="Integraciones"
        description="Los canales por los que Tuvetia habla con tus titulares y con tu agenda."
      />

      <div className="flex flex-col gap-4">
        <section className="rounded-lg border border-line-soft bg-card p-4">
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
            cupoAutoDeHoy={cupoAutoDeHoy}
            requisitos={requisitosDelAuto}
          />
        </section>

        {/* Acá vivía "Correo de la clínica", que pedía una contraseña de aplicación de Gmail para
            mandar por SMTP. Se quitó porque describía algo que ya no era cierto: las facturas y la
            cobranza salen por el correo de Tuvetia desde hace semanas (`lib/email/transactional.ts`),
            con el nombre de la clínica como remitente. La tarjeta seguía diciendo "Envío (SMTP)
            smtp.gmail.com · verificado", que era falso, y pedía una credencial que no se usaba para
            nada. En su lugar va una nota: no hay nada que conectar, y conviene decir por qué. */}
        <section className="rounded-lg border border-line-soft bg-card p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-fg">
            <Mail className="size-4 text-fg-faint" aria-hidden /> Facturas y cobranza
          </div>
          <p className="text-sm text-fg-muted">
            No hay nada que conectar. Las facturas y los recordatorios de pago salen por el correo de
            Tuvetia, <b>a nombre de tu clínica</b>, y si el titular responde, la respuesta le llega al
            administrador. Lo de abajo es distinto: es tu cuenta personal, para que VetGPT escriba
            <i> por vos</i>.
          </p>
        </section>

        <section className="rounded-lg border border-line-soft bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <Mail className="size-4 text-fg-faint" aria-hidden /> Correo de VetGPT
            <HelpTip>
              Es <b>tu</b> cuenta, no la de la clínica: cada miembro conecta la suya —<b>Gmail</b> u{" "}
              <b>Outlook</b>— y VetGPT usa la de quien le está pidiendo algo. Nunca escribe desde la
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

        <section className="rounded-lg border border-line-soft bg-card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-fg">
            <CalendarDays className="size-4 text-fg-faint" aria-hidden /> Calendario
            <HelpTip>
              Cada cita se crea en el calendario del <b>veterinario asignado</b>, e invita al{" "}
              <b>titular</b>, a <b>todos los administradores</b> y a quien la agendó — como cuando te
              llega una invitación a una reunión. Por eso un administrador tiene siempre la clínica
              entera en su calendario. Tuvetia solo <b>escribe</b>; nunca lee tus eventos.
            </HelpTip>
          </div>
          <p className="mb-3 text-sm text-fg-muted">
            {calendarConnected
              ? esAdministrador
                ? "Las citas que te asignen se crean en tu calendario, y como administrador te llegan además todas las de la clínica por invitación."
                : "Las citas que te asignen se crean en tu calendario, con el titular y los administradores invitados."
              : esAdministrador
                ? "Conectá tu calendario: las citas que te asignen se van a crear ahí, y las del resto del equipo te van a llegar por invitación. Además es el calendario de respaldo de la clínica, donde caen las citas de quien todavía no conectó el suyo."
                : /* SE SIGUE NOMBRANDO AL ADMINISTRADOR. Se agregó el 21-ago por un motivo que no
                     caducó: decir "el administrador" sin decir QUIÉN deja al vet sin saber a quién
                     preguntarle. Lo que ya NO se dice es "este conector no te aparece" — desde v5
                     sí le aparece, y el botón está acá abajo. */
                  calendarioDeRespaldo.conectado
                  ? `Todavía no conectaste el tuyo, así que tus citas se están creando en el calendario ${nombreDelAdministrador ? `de ${nombreDelAdministrador}` : "del administrador"} y a vos te llega la invitación por correo. Conectá el tuyo para tenerlas en tu propia agenda.`
                  : `Todavía no conectaste el tuyo, y ${nombreDelAdministrador ?? "el administrador"} tampoco: las citas quedan sólo en Tuvetia y nadie recibe invitación.`}
          </p>
          <CalendarSettings
            connected={calendarConnected}
            compartidoConElCorreo={miCalendario.compartidoConElCorreo}
          />
        </section>
      </div>
    </PageShell>
  )
}
