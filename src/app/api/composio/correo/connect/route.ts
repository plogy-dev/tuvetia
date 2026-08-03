import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAppBaseUrl } from "@/lib/base-url"
import { iniciarConexion, proveedoresDisponibles, type Proveedor } from "@/lib/composio/correo"

export const runtime = "nodejs"

/**
 * A dónde vuelve el veterinario después de autorizar.
 *
 * Se toma del ORIGEN DE LA PETICIÓN, no de una variable de entorno. Con `NEXT_PUBLIC_APP_URL` sin
 * definir el callback salía relativo, Composio no podía usarlo y dejaba al vet en el dashboard de
 * Composio en vez de devolverlo a la app — que fue exactamente lo que pasó la primera vez.
 */
function callbackUrl(req: Request, volverA: string | undefined): string {
  const origen =
    req.headers.get("origin") ??
    (() => {
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
      if (!host) return null
      const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
      return `${proto}://${host}`
    })() ??
    getAppBaseUrl()
  // Solo rutas internas del dashboard: `volverA` viene del cliente, y una URL absoluta acá sería
  // un redirect abierto con la app como trampolín.
  const destino = volverA && /^\/dashboard\/[\w/-]*$/.test(volverA) ? volverA : "/dashboard/conexiones"
  return `${origen.replace(/\/$/, "")}${destino}?correo=conectado`
}

/** Qué proveedores puede ofrecer este despliegue — lo consulta la tarjeta del chat. */
export async function GET() {
  return NextResponse.json({ proveedores: proveedoresDisponibles() })
}

// Empieza la conexión del correo del MIEMBRO que la pide, con el proveedor que eligió. Devuelve la
// URL a la que el navegador tiene que ir; el token queda del lado de Composio y nunca pasa por acá.
export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { proveedor?: string; volverA?: string }
  const disponibles = proveedoresDisponibles()
  const proveedor = disponibles.find((p) => p === body.proveedor) as Proveedor | undefined
  if (!proveedor) {
    return NextResponse.json(
      { error: `Proveedor no disponible. Configurados: ${disponibles.join(", ") || "ninguno"}.` },
      { status: 400 },
    )
  }

  try {
    const url = await iniciarConexion(user.id, proveedor, callbackUrl(req, body.volverA))
    return NextResponse.json({ url })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
