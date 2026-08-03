import type { MetadataRoute } from "next"

import { getAppBaseUrl } from "@/lib/base-url"

/**
 * Hasta hoy no existía `robots.txt` ni un solo `noindex` en todo el repo, así que todo lo público
 * era indexable — incluidos `/signup` y los dos legales, que dicen "Documento en preparación".
 *
 * OJO CON LO QUE ESTO NO HACE: `robots.txt` es una petición, no un control de acceso. Esconde
 * `/signup` de Google, pero el registro SIGUE ABIERTO — `signup-form.tsx` crea cuenta con cualquier
 * correo (`shouldCreateUser: true`) y el OAuth de Google y Microsoft no tiene ningún gate. Si las
 * pruebas con design partners son cerradas, hay que cerrarlo de verdad (allowlist o código de
 * invitación); esto sólo baja la probabilidad de que alguien lo encuentre de casualidad.
 *
 * `/dashboard` y `/admin` ya están protegidos por sesión y por allowlist de email — van acá para no
 * gastar presupuesto de rastreo en URLs que sólo devuelven redirecciones.
 */
export default function robots(): MetadataRoute.Robots {
  const base = getAppBaseUrl()
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/admin", "/api", "/auth", "/bienvenida", "/signup", "/login"],
    },
    sitemap: `${base}/sitemap.xml`,
  }
}
