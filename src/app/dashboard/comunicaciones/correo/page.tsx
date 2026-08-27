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

  // ── EL BUCLE QUE ESTA RAMA CERRABA ──────────────────────────────────────────────────────────
  //
  // Había UNA sola rama para «no hay bandeja», y mandaba siempre a Integraciones diciendo «es un
  // clic». Cuando el servidor no tiene Composio configurado, Integraciones contesta «la conexión de
  // correo no está disponible en este servidor todavía» — o sea que el vet iba, volvía y quedaba
  // exactamente donde empezó, sin nada que hacer y creyendo que él había hecho algo mal.
  //
  // Lo llamativo es que el dato para evitarlo YA ESTABA ACÁ: `disponible` se calcula arriba y sólo
  // se usaba para decidir si consultar la conexión. Faltaba usarlo para hablar.
  //
  // Son dos situaciones distintas y ahora se dicen distinto: una es «falta que conectes tu cuenta»
  // —acción tuya, un clic de verdad— y la otra es «esto todavía no está habilitado», que no es
  // culpa del vet y no tiene botón porque no hay nada que él pueda apretar.
  if (!disponible) {
    return (
      <div className="mx-auto flex w-full max-w-md flex-col items-center gap-4 px-6 py-16 text-center">
        <Mail className="size-10 text-muted-foreground" />
        <h1 className="text-lg font-semibold">El correo todavía no está habilitado</h1>
        <p className="text-sm text-muted-foreground">
          Leer y responder correo desde Tuvetia es una función que todavía no está activa en esta
          instalación. No es algo que puedas configurar vos: cuando quede lista, la vas a ver acá
          sin tener que hacer nada.
        </p>
        {/* Una salida REAL en vez de la vuelta a Integraciones. WhatsApp no depende de Composio
            —entra por el webhook de Kapso— así que es el canal que sí funciona hoy. */}
        <p className="text-sm text-muted-foreground">
          Mientras tanto, <b>WhatsApp sí está andando</b> y es por donde escribe la mayoría de los
          titulares.
        </p>
        <Button variant="outline" render={<Link href="/dashboard/comunicaciones" />}>
          Ir a WhatsApp
        </Button>
      </div>
    )
  }

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
