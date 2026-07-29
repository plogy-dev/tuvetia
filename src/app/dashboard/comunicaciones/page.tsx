import Link from "next/link"
import { MessageCircle } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { DataError } from "@/components/data-error"
import { WhatsappInbox, type InboxMessage, type InboxOwner } from "@/components/whatsapp/inbox"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Comunicaciones · Tuvetia" }

// Bandeja de WhatsApp de la clínica. Los mensajes llegan por el webhook de Kapso a
// whatsapp_messages (RLS por clínica); el envío sale por /api/whatsapp/send.
export default async function ComunicacionesPage() {
  const supabase = await createClient()

  const [{ data: integ }, { data: msgs, error: msgsError }, { data: owners }] = await Promise.all([
    supabase.from("whatsapp_integrations").select("status, phone_number").maybeSingle(),
    supabase
      .from("whatsapp_messages")
      .select("id, owner_id, wa_message_id, wa_phone_from, wa_phone_to, direction, body, media_type, read_at, delivered_at, failed_at, error_detail, created_at")
      // Payload inicial acotado: las conversaciones viejas salen del historial reciente; el poll
      // trae lo nuevo. (Paginación hacia atrás: backlog.)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("owners").select("id, full_name, phone").not("phone", "is", null).order("full_name"),
  ])

  const integration = integ as { status: string; phone_number: string | null } | null
  const connected = integration?.status === "connected"

  if (!connected) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
        <MessageCircle className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">WhatsApp no está conectado</h1>
        <p className="text-sm text-muted-foreground">
          Conectá el WhatsApp de tu clínica escaneando un QR — seguís usando tu teléfono como siempre
          y las conversaciones también llegan acá. Requiere la app <b>WhatsApp Business</b> (gratuita).
        </p>
        <Button render={<Link href="/dashboard/settings" />}>Conectar en Configuración</Button>
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
