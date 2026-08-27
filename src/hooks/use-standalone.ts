import * as React from "react"

// ¿La página corre DENTRO de la app instalada (pantalla de inicio), o en un navegador con barra?
//
// Mismo molde que `use-mobile.ts`: `useSyncExternalStore` da la lectura síncrona en cliente sin
// setState en un efecto (que el lint prohíbe con razón) y `false` en SSR — el servidor no puede
// saberlo, y asumir navegador es lo que no rompe nada si se equivoca.
//
// La suscripción no es adorno: en Android, instalar desde el aviso del navegador puede trasladar
// la pestaña a la app instalada sin recargar, y `change` es lo que entera a la interfaz.

const QUERY = "(display-mode: standalone)"

function subscribe(callback: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", callback)
  return () => mql.removeEventListener("change", callback)
}

export function useEsInstalada() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  )
}
