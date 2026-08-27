"use client"

// ¿Queda contenido por debajo del borde de este contenedor?
//
// ── PARA QUÉ ───────────────────────────────────────────────────────────────────────────────────
//
// Un contenedor con `overflow-y-auto` que no muestra barra —y en este sistema ninguna la muestra,
// porque el cliente pidió sacarlas— es indistinguible de uno que ya mostró todo. El usuario no
// scrollea porque no sabe que hay algo más.
//
// Pasó dos veces con dos días de diferencia:
//
//   26-ago · la barra lateral escondía sus últimos ítems en un portátil de 768 px, y se resolvió
//            con un degradado al pie (`ui/sidebar.tsx`).
//   27-ago · la lista de calendarios de la agenda quedaba cortada a mitad de un nombre y el último
//            veterinario no se veía. Se resolvió QUITÁNDOLE el scroll a esa columna, lo que devolvió
//            el desplazamiento a la página entera — el defecto que se había cerrado esa mañana.
//
// El segundo caso no necesitaba menos scroll: necesitaba la misma señal que el primero. Este gancho
// es esa pieza, para que el tercero no vuelva a resolverse quitando algo.
//
// ── POR QUÉ TRES OBSERVACIONES Y NO UNA ────────────────────────────────────────────────────────
//
// El evento `scroll` no alcanza: el contenido cambia de alto sin que nadie scrollee —se pliega una
// sección, llega otro veterinario a la clínica— y el contenedor cambia de alto sin que cambie su
// contenido, cuando el reparto del flex se mueve. Hacen falta las tres.

import { useEffect, useRef, useState } from "react"

/**
 * El degradado que dice «hay más». Va como `mask-image` y no como un elemento encima a propósito:
 * una máscara no ocupa lugar en el layout, no intercepta clics y no obliga a envolver el contenedor
 * en otro div —que sería cambiarle la caja a un hijo flex que ya está calibrado—.
 *
 * Se exporta para que quien lo use lo escriba en SU `style`, y no lo devuelve el gancho ya armado:
 * así cada consumidor decide cómo lo mezcla con el resto de sus estilos en línea.
 */
export const DESVANECER_AL_PIE = "linear-gradient(to bottom, #000 calc(100% - 28px), transparent)"

/**
 * `ref` para el contenedor que scrollea y `hayMas` para pintar la señal.
 *
 * `hayMas` se apaga al llegar al final, así que cuando no queda nada abajo no se ve nada.
 */
export function useHayMasAbajo<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T>(null)
  const [hayMas, setHayMas] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // 4 px de tolerancia: los navegadores redondean `scrollHeight` y sin holgura el degradado
    // parpadea al final del recorrido.
    const medir = () => setHayMas(el.scrollHeight - el.scrollTop - el.clientHeight > 4)

    medir()
    el.addEventListener("scroll", medir, { passive: true })
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    const mo = new MutationObserver(medir)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      el.removeEventListener("scroll", medir)
      ro.disconnect()
      mo.disconnect()
    }
  }, [])

  return { ref, hayMas }
}
