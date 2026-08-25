import { redirect } from "next/navigation"

// La configuración se mudó a `/dashboard/administracion/clinica`, dentro del panel de
// administración (25-ago). Esta ruta queda como redirección y NO como una copia.
//
// ── POR QUÉ SIGUE EXISTIENDO ──────────────────────────────────────────────────────────────────
//
// Porque hay enlaces a `/dashboard/settings` que no están en este repo y no podemos repuntar:
// correos viejos, cosas que alguien marcó, y sobre todo el callback de WhatsApp, que vuelve del
// proveedor a `?whatsapp=connected`. Borrar la ruta convertiría esos tres en un 404.
//
// ── LA QUERY VIAJA ────────────────────────────────────────────────────────────────────────────
//
// Se reenvía tal cual. Si se perdiera, el vet volvería de conectar WhatsApp a una pantalla que no
// le dice que quedó conectado — que es justo el momento en que necesita esa confirmación.

export default async function SettingsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const qs = new URLSearchParams()
  for (const [clave, valor] of Object.entries(params)) {
    if (Array.isArray(valor)) valor.forEach((v) => qs.append(clave, v))
    else if (valor !== undefined) qs.append(clave, valor)
  }
  const cola = qs.toString()
  redirect(`/dashboard/administracion/clinica${cola ? `?${cola}` : ""}`)
}
