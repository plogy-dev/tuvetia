"use client"

import { useEffect } from "react"

// Repone el salto al `#ancla` de la URL cuando la pantalla ya está montada.
//
// ── POR QUÉ EL FRAGMENTO SOLO NO ALCANZA ACÁ ──────────────────────────────────────────────────
//
// Next sí scrollea al `#id` en cada navegación, pero lo intenta UNA sola vez y demasiado
// temprano. El que scrollea es `ScrollAndFocusHandler`, y en el árbol ese componente ENVUELVE al
// `<Suspense>` de `loading.tsx`. Como `app/dashboard/loading.tsx` cubre a todas las pantallas
// del panel, en el instante en que Next busca el ancla lo que está montado es el esqueleto: el
// `getElementById` no encuentra nada, Next scrollea el esqueleto y —esto es lo que mata el
// ancla— APAGA el fragmento (`focusAndScrollRef.hashFragment = null`, en
// `next/dist/client/components/layout-router.js`). Cuando el contenido real llega, ya no queda a
// dónde ir y no vuelve a intentarlo.
//
// Se ve como intermitencia: el ancla "a veces anda" —cuando la pantalla resuelve rápido y no
// alcanza a pintarse el esqueleto— y en la práctica no anda. Es exactamente el defecto que
// `legal/privacidad` no tiene, porque ahí el ancla es de la misma pantalla y no hay carga de por
// medio; por eso ese `scroll-mt-6` a secas sí es suficiente y acá no.
//
// EL FRAGMENTO SE MANTIENE EN EL ENLACE igual: es la URL que se comparte, la que sobrevive a una
// recarga y la que el navegador entiende sin nosotros. Esto no la reemplaza — sólo repite el
// salto en el único momento en que el destino existe seguro, que es el efecto de esta pantalla.
export function LlevarAlAncla() {
  useEffect(() => {
    // `decodeURIComponent` porque un id con acentos viaja escapado en la barra de direcciones.
    // Y va envuelto porque TIRA `URIError` con un `%` suelto —`#50%`, una URL pegada a medias—:
    // esto corre en un efecto, así que una excepción acá no deja el ancla sin efecto, tumba la
    // pantalla entera contra el error boundary. Un fragmento torcido no es un id: se busca crudo
    // y, si tampoco existe, no se salta y listo.
    const crudo = window.location.hash.slice(1)
    if (!crudo) return
    let id: string
    try {
      id = decodeURIComponent(crudo)
    } catch {
      id = crudo
    }

    const destino = document.getElementById(id)
    if (!destino) return

    destino.scrollIntoView({ block: "start" })
    // El mismo cierre que hace Next después de scrollear: mover el foco al destino. Sin esto, el
    // primer Tab de quien llegó por el enlace arranca desde el principio de la pantalla, o sea
    // desde arriba de todo — que es justo el viaje que el ancla vino a ahorrar.
    // `preventScroll` porque el scroll ya lo hicimos y `focus()` volvería a decidirlo por su
    // cuenta, con otro encuadre.
    destino.focus({ preventScroll: true })
  }, [])

  return null
}
