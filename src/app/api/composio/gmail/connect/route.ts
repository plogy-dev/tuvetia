import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAppBaseUrl } from "@/lib/base-url"
import { iniciarConexion } from "@/lib/composio/gmail"

export const runtime = "nodejs"

/**
 * A dónde vuelve el veterinario después de autorizar en Google.
 *
 * Se toma del ORIGEN DE LA PETICIÓN, no de una variable de entorno. Con `NEXT_PUBLIC_APP_URL` sin
 * definir el callback salía relativo, Composio no podía usarlo y dejaba al vet en el dashboard de
 * Composio en vez de devolverlo a la app — que fue exactamente lo que pasó la primera vez.
 *
 * Derivarlo del request funciona igual en local (sea cual sea el puerto), en un preview y en
 * producción, sin depender de que alguien configure nada. `getAppBaseUrl()` queda de respaldo por si
 * el origen no viaja (algunos proxies lo omiten).
 */
function callbackUrl(req: Request): string {
  const origen =
    req.headers.get("origin") ??
    (() => {
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
      if (!host) return null
      const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
      return `${proto}://${host}`
    })() ??
    getAppBaseUrl()
  return `${origen.replace(/\/$/, "")}/dashboard/conexiones?correo=conectado`
}

// Empieza la conexión del Gmail del MIEMBRO que la pide. Devuelve la URL de Google a la que el
// navegador tiene que ir; el token queda del lado de Composio y nunca pasa por acá.
//
// El `userId` de Composio es nuestro `profiles.id`: por eso la cuenta que conecta esta persona es
// exactamente la que Athos va a usar cuando esta persona le pida algo.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  try {
    const url = await iniciarConexion(user.id, callbackUrl(req))
    return NextResponse.json({ url })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
