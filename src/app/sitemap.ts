import type { MetadataRoute } from "next"

import { getAppBaseUrl } from "@/lib/base-url"

/**
 * Las cuatro rutas públicas del grupo `(marketing)`. Nada más: el resto del sitio está detrás de
 * sesión, y los dos legales quedan fuera a propósito mientras sigan diciendo "Documento en
 * preparación" — listarlos sería pedir que se indexe una página vacía.
 *
 * Sin `lastModified`: poner `new Date()` haría que cada build declare que todo cambió hoy, que es
 * ruido y además falso. Cuando haya fechas reales de publicación, van acá.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = getAppBaseUrl()
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    { url: `${base}/producto`, changeFrequency: "monthly", priority: 0.8 },
    { url: `${base}/seguridad`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/demo`, changeFrequency: "monthly", priority: 0.9 },
  ]
}
