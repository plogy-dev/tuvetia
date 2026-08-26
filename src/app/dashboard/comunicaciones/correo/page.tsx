import Link from "next/link"
import { Mail } from "lucide-react"

import { sesionDelServidor } from "@/lib/supabase/sesion"
import { DataError } from "@/components/data-error"
import { EmailInbox } from "@/components/email/inbox"
import { Button } from "@/components/ui/button"
import { buscarCorreos, composioConfigurado, estadoConexion } from "@/lib/composio/correo"

export const metadata = { title: "Correo · Tuvetia" }
export const dynamic = "force-dynamic"

// Bandeja del correo del MIEMBRO, leída EN VIVO desde su cuenta (Gmail u Outlook) vía Composio.
//
// No hay copia en nuestra base: ni tablas, ni barrido periódico, ni realtime. Antes sí la había
// (email_threads/email_messages, llenadas por IMAP) y el precio era alto — un cursor que mantener,
// deduplicación, hilado, y el correo entero de la clínica guardado en nuestros servidores. Leer
// contra Gmail cuando alguien abre la página quita todo eso; el costo es esperar la respuesta.
export default async function CorreoPage() {
  const { user } = await sesionDelServidor()

  const disponible = composioConfigurado()
  const conexion =
    user && disponible
      ? await estadoConexion(user.id)
      : { conectado: false, proveedor: null, email: null }

  if (!conexion.conectado) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
        <Mail className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">No conectaste tu correo</h1>
        <p className="text-sm text-muted-foreground">
          Conectá <b>tu</b> cuenta de correo —Gmail u Outlook— para leer y responder desde acá, y
          para que VetGPT pueda escribirles a los titulares por vos. Es un clic.
        </p>
        <Button render={<Link href="/dashboard/conexiones" />}>Conectar en Integraciones</Button>
      </div>
    )
  }

  const bandeja = await buscarCorreos(user!.id, { limite: 25 })

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-4 lg:px-6">
        <p className="text-xs text-muted-foreground">{conexion.email ?? "Tu cuenta de correo"}</p>
      </div>
      {!bandeja.ok && (
        <div className="px-4 pt-4 lg:px-6">
          <DataError>No se pudo leer tu correo: {bandeja.error}</DataError>
        </div>
      )}
      <EmailInbox correos={bandeja.ok ? bandeja.correos : []} proveedor={conexion.proveedor} />
    </>
  )
}
