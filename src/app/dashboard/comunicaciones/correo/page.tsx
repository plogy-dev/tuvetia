import Link from "next/link"
import { Mail } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { DataError } from "@/components/data-error"
import { EmailInbox, EmailRefreshButton, type InboxEmail, type InboxThread } from "@/components/email/inbox"
import { Button } from "@/components/ui/button"

export const metadata = { title: "Correo · Tuvetia" }

// Bandeja de correo. Los mensajes entran por el barrido IMAP (src/lib/email/inbox.ts, colgado del
// cron de cartera) a email_threads/email_messages, con RLS por clínica. El envío sale por
// /api/email/reply.
export default async function CorreoPage() {
  const supabase = await createClient()

  const [{ data: integ }, { data: hilos, error: hilosError }, { data: msgs }] = await Promise.all([
    supabase.from("email_integrations").select("status, from_email").maybeSingle(),
    supabase
      .from("email_threads")
      .select("id, subject, participants, owner_id, last_message_at, unread_count, owner:owners(full_name)")
      .order("last_message_at", { ascending: false })
      .limit(100),
    // Payload inicial acotado: los hilos viejos se abren igual, con lo que ya haya en memoria.
    supabase
      .from("email_messages")
      .select("id, thread_id, direction, from_email, subject, body_text, snippet, created_at, attachments")
      .order("created_at", { ascending: false })
      .limit(300),
  ])

  const integration = integ as { status: string; from_email: string | null } | null
  if (integration?.status !== "connected") {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
        <Mail className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">El correo no está conectado</h1>
        <p className="text-sm text-muted-foreground">
          Conectá la cuenta de correo de la clínica para leer y responder desde acá. Se usa una{" "}
          <b>contraseña de aplicación</b> de Gmail, nunca la contraseña de la cuenta.
        </p>
        <Button render={<Link href="/dashboard/conexiones" />}>Conectar en Conexiones</Button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 lg:px-6">
        <p className="text-xs text-muted-foreground">{integration.from_email}</p>
        <EmailRefreshButton />
      </div>
      {hilosError && (
        <div className="px-4 pt-4 lg:px-6">
          <DataError>
            No se pudieron cargar los correos; la bandeja puede verse vacía. Recargá la página.
          </DataError>
        </div>
      )}
      <EmailInbox
        initialThreads={(hilos as unknown as InboxThread[] | null) ?? []}
        initialMessages={((msgs as unknown as InboxEmail[] | null) ?? []).slice().reverse()}
      />
    </>
  )
}
