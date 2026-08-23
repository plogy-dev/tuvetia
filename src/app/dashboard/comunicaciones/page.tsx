import { MessageCircle } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { DataError } from "@/components/data-error"
import { WhatsappInbox, type InboxMessage, type InboxOwner } from "@/components/whatsapp/inbox"
import { WhatsappSettings } from "@/components/settings/whatsapp-settings"

export const metadata = { title: "Comunicaciones · Tuvetia" }

// Bandeja de WhatsApp de la clínica. Los mensajes llegan por el webhook de Kapso a
// whatsapp_messages (RLS por clínica); el envío sale por /api/whatsapp/send.
export default async function ComunicacionesPage() {
  const supabase = await createClient()

  const [{ data: integ }, { data: msgs, error: msgsError }, { data: owners }] = await Promise.all([
    supabase.from("whatsapp_integrations").select("status, phone_number, agent_mode").maybeSingle(),
    supabase
      .from("whatsapp_messages")
      .select("id, owner_id, wa_message_id, wa_phone_from, wa_phone_to, direction, body, media_type, media_url, read_at, delivered_at, failed_at, error_detail, created_at, provider_timestamp")
      // Payload inicial acotado: las conversaciones viejas salen del historial reciente; el poll
      // trae lo nuevo. (Paginación hacia atrás: backlog.)
      //
      // Se traen los 100 más recientes POR LLEGADA, no por hora del proveedor, y por la misma razón
      // que el cursor: es el orden con el que "los últimos 100" significa algo estable. El hilo los
      // reordena por `provider_timestamp` al pintarlos.
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("owners").select("id, full_name, phone").not("phone", "is", null).order("full_name"),
  ])

  const integration = integ as {
    status: string
    phone_number: string | null
    agent_mode: "auto" | "review" | "paused" | "intervene" | null
  } | null
  const connected = integration?.status === "connected"

  if (!connected) {
    return (
      // EL QR SE ESCANEA ACÁ MISMO. Antes esta pantalla tenía un botón "Conectar en Configuración",
      // y ese viaje era peor de lo que parecía: Configuración ya no tiene el conector —se mudó a
      // Conexiones— así que quien lo seguía llegaba a una línea de estado y a otro enlace. Dos
      // saltos para escanear un código.
      //
      // David lo pidió el 19-ago: que el QR esté en la propia pantalla de Comunicaciones. Y tiene
      // sentido más allá de los clics — es acá donde uno se da cuenta de que hace falta conectar,
      // porque es acá donde no hay mensajes.
      //
      // ES EL MISMO COMPONENTE que usa Conexiones, no una copia: el flujo de vinculación tiene
      // consentimiento, reintentos y tres proveedores detrás. Dos implementaciones del mismo QR
      // serían dos que arreglar cada vez.
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16">
        <MessageCircle className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">WhatsApp no está conectado</h1>
        <p className="text-center text-sm text-muted-foreground">
          Conectalo acá y las conversaciones con los titulares empiezan a llegar a esta bandeja.
        </p>
        <div className="w-full rounded-xl border bg-card p-4">
          <WhatsappSettings
            initialStatus={(integration?.status as "none" | "pending" | "disconnected") ?? "none"}
            initialPhone={integration?.phone_number ?? null}
            initialAgentMode={integration?.agent_mode ?? "review"}
          />
        </div>
      </div>
    )
  }

  return (
    <>
      {msgsError && (
        <div className="px-4 pt-4 lg:px-6">
          <DataError>
            No se pudieron cargar los mensajes; la bandeja puede verse vacía. Recargá la página.
          </DataError>
        </div>
      )}
      <WhatsappInbox
        initialMessages={((msgs as InboxMessage[] | null) ?? []).slice().reverse()}
        owners={(owners as InboxOwner[] | null) ?? []}
        clinicPhone={integration?.phone_number ?? ""}
      />
    </>
  )
}
