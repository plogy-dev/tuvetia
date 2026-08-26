// ¿Este ítem del sidebar corresponde a la ruta que se está viendo?
//
// Vivía duplicado y en desacuerdo entre tres componentes: uno comparaba por prefijo, `nav-main.tsx`
// sólo por igualdad exacta —y por eso las DIECISÉIS páginas de facturación y las fichas
// `/patients/[id]` no encendían su sección— y `nav-secondary.tsx` no comparaba nada. Hoy quedan dos
// consumidores (`nav-main.tsx` y `nav-secondary.tsx`): el tercero, `nav-documents.tsx`, se borró al
// unificar el sidebar en una sola lista.
//
// `/dashboard` es la excepción y va por igualdad: es prefijo de todas las demás rutas del panel, y
// por prefijo se quedaría encendido en las 30+ pantallas a la vez.
export function isNavActive(pathname: string, url: string): boolean {
  if (url === "/dashboard") return pathname === url
  return pathname === url || pathname.startsWith(url + "/")
}

/**
 * De un conjunto de ítems que coinciden con la ruta, cuál se enciende: EL MÁS ESPECÍFICO.
 *
 * Existe porque el 25-ago aparecieron dos anidados en el mismo grupo del pie: «Administración»
 * (`/dashboard/administracion`) y «Configuración» (`/dashboard/administracion/clinica`). En
 * `/administracion/clinica` los dos coincidían por prefijo y los dos se encendían — dos ítems
 * activos a la vez se lee como un glitch, no como una jerarquía.
 *
 * La regla del prefijo en `isNavActive` sigue siendo correcta ítem a ítem (es lo que enciende
 * «Ventas» en sus dieciséis subpantallas); lo que faltaba era el desempate ENTRE ítems, y eso sólo
 * puede decidirlo quien ve la lista completa.
 */
export function urlActivaEntre(pathname: string, urls: string[]): string | null {
  const coinciden = urls.filter((u) => isNavActive(pathname, u))
  if (coinciden.length === 0) return null
  return coinciden.sort((a, b) => b.length - a.length)[0]
}
