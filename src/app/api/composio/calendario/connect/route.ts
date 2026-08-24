import { NextResponse } from "next/server"

import { createClient } from "@/lib/supabase/server"
import { getAppBaseUrl } from "@/lib/base-url"
import { rutaDeVuelta } from "@/lib/ruta-de-vuelta"
import {
  calendariosDisponibles,
  iniciarConexionCalendario,
  type ProveedorCalendario,
} from "@/lib/composio/calendario"

export const runtime = "nodejs"

// Empieza la conexión del calendario del VETERINARIO que la pide. Devuelve la URL a la que tiene
// que ir el navegador; el token queda del lado de Composio y nunca pasa por acá.
//
// Reemplaza al camino anterior, que pedía OAuth por Supabase y se quedaba con
// `session.provider_refresh_token`. Eso arrastraba un problema propio: ese token es el del proveedor
// con el que se INICIÓ SESIÓN, no el del botón que se apretó — alguien entró con Microsoft y el
// token de Microsoft terminó guardado en la fila de Google. Acá no puede pasar: la autorización es
// del calendario, no de la sesión.

// A dónde vuelve el navegador después del consentimiento. `volverA` existe porque la conexión ya no
// se pide sólo desde Integraciones: desde v5 la agenda le abre una ventana a quien no tiene
// calendario conectado y lo manda a conectarlo de una vez, y tiene que volver ahí. El saneado vive
// en `lib/ruta-de-vuelta.ts` —es una guarda contra redirección abierta y merece sus propios tests—
// y todo lo que no sea una ruta del dashboard cae al default.
function callbackUrl(req: Request, volverA: unknown): string {
  const origen =
    req.headers.get("origin") ??
    (() => {
      const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
      if (!host) return null
      const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")
      return `${proto}://${host}`
    })() ??
    getAppBaseUrl()
  return `${origen.replace(/\/$/, "")}${rutaDeVuelta(volverA)}?calendario=conectado`
}

/** Qué calendarios puede ofrecer este despliegue. */
export async function GET() {
  return NextResponse.json({ proveedores: calendariosDisponibles() })
}

export async function POST(req: Request) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "No autenticado" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as { proveedor?: string; volverA?: string }
  const disponibles = calendariosDisponibles()
  const proveedor = disponibles.find((p) => p === body.proveedor) as ProveedorCalendario | undefined
  if (!proveedor) {
    return NextResponse.json(
      { error: `Calendario no disponible. Configurados: ${disponibles.join(", ") || "ninguno"}.` },
      { status: 400 },
    )
  }

  try {
    return NextResponse.json({
      url: await iniciarConexionCalendario(user.id, proveedor, callbackUrl(req, body.volverA)),
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 })
  }
}
