// ¿Este ítem del sidebar corresponde a la ruta que se está viendo?
//
// Vivía duplicado y en desacuerdo: `nav-documents.tsx` comparaba por prefijo, `nav-main.tsx` sólo
// por igualdad exacta —y por eso las DIECISÉIS páginas de facturación y las fichas
// `/patients/[id]` no encendían su sección— y `nav-secondary.tsx` no comparaba nada.
//
// `/dashboard` es la excepción y va por igualdad: es prefijo de todas las demás rutas del panel, y
// por prefijo se quedaría encendido en las 30+ pantallas a la vez.
export function isNavActive(pathname: string, url: string): boolean {
  if (url === "/dashboard") return pathname === url
  return pathname === url || pathname.startsWith(url + "/")
}
