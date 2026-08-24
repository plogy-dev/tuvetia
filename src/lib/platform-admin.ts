import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"

// Gate del panel de plataforma (/admin) — SOLO servidor.
// Allowlist de emails en PLATFORM_ADMIN_EMAILS (separados por coma). Sin la env, nadie entra
// (seguro por defecto). El panel es ajeno al producto: no usa roles de clínica.

export function isPlatformAdmin(email: string | null | undefined): boolean {
  if (!email) return false
  const raw = process.env.PLATFORM_ADMIN_EMAILS
  if (!raw) return false
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(email.toLowerCase())
}

/**
 * El gate del panel, para llamar AL PRINCIPIO DE CADA PÁGINA — no sólo en el layout.
 *
 * ── POR QUÉ NO ALCANZA CON EL LAYOUT (medido en producción el 24-ago) ─────────────────────────
 *
 * El layout ya hacía `if (!isPlatformAdmin(...)) notFound()`, y aun así una petición ANÓNIMA a
 * `/admin/usuarios` devolvía **404 con 66 KB de cuerpo y 23 correos reales adentro**. Lo mismo en
 * `/admin/clinicas` y `/admin/costos` con los nombres de las clínicas.
 *
 * El motivo es que en el App Router el layout y la página se renderizan EN PARALELO. El
 * `notFound()` del layout corta la interfaz, pero la página ya corrió sus consultas —con
 * `service_role`, que se salta la RLS— y sus datos quedan serializados en la respuesta. El 404 es
 * de la pantalla, no de los datos.
 *
 * Los docs de Next lo dicen sin rodeos: «A common pattern in SPAs is to return null in a layout…
 * This pattern is **not recommended** since Next.js applications have multiple entry points, which
 * will not prevent nested route segments and Server Actions from being accessed.»
 *
 * VA ANTES DE CUALQUIER CONSULTA, en la primera línea del componente. Después de un `await` de
 * datos ya no sirve: lo que se filtra es justamente el resultado de ese await.
 *
 * Las server actions del panel NO dependen de esto: cada una comprueba por su cuenta con
 * `adminActual()`. Por eso el agujero era de lectura y nunca de escritura.
 */
export async function requerirAdminDePlataforma(): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!isPlatformAdmin(user?.email)) notFound()
}
