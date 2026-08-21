// Si el historial de Athos en la barra está plegado o desplegado, y que se acuerde.
//
// LO QUE PIDIÓ DAVID, el 19-ago: *"las consultas y los chats, abajo y plegables"*. Las dos mitades
// resuelven la misma molestia: el historial vive en la barra lateral, y con cuarenta consultas
// cargadas empuja todo lo demás fuera de la vista justo en la pantalla donde uno está trabajando.
//
// SE RECUERDA, y esa es la parte que hace que "plegable" signifique algo. Un panel que se pliega y
// vuelve a abrirse solo en cada navegación no está plegado: está molestando una vez por página.
//
// ── POR QUÉ ESTO ES UN MÓDULO Y NO TRES LÍNEAS ADENTRO DEL COMPONENTE ───────────────────────────
//
// Porque `localStorage` devuelve `string | null` y ahí adentro puede haber cualquier cosa: una
// versión vieja del valor, algo que escribió otra pestaña, o basura de una extensión. Leer eso sin
// cuidado es cómo un panel termina plegado para siempre sin que nadie sepa por qué — y el usuario
// no tiene forma de arreglarlo salvo limpiar el navegador.
//
// Puro y sin `window`: se le pasa el crudo. Así se prueba, que es lo único que hace verificable la
// regla de "ante la duda, abierto".

export const CLAVE_HISTORIAL_PLEGADO = "tuvetia:athos-historial-plegado"

/**
 * ¿Arranca plegado?
 *
 * **ANTE LA DUDA, ABIERTO.** Sin valor guardado, con basura, o con algo de una versión anterior, el
 * historial se muestra. Es la falla barata: un panel abierto que no se quería se cierra con un
 * clic; uno plegado que sí se quería es una función que desapareció sin explicación.
 *
 * Y sólo aparece dentro de Athos y del Modo Fantasma, donde es lo que se está usando.
 */
export function estaPlegado(crudo: string | null | undefined): boolean {
  return crudo === "1"
}

/** Lo que se guarda. Dos valores y nada más — no hay estado intermedio que representar. */
export function valorAGuardar(plegado: boolean): string {
  return plegado ? "1" : "0"
}

// ── El almacén externo, para leerlo sin romper la hidratación ───────────────────────────────────
//
// `useSyncExternalStore` Y NO `useState` + `useEffect`. Las dos formas evitan el error de
// hidratación —el servidor no tiene `window`—, pero la del efecto llama a `setState` dentro del
// efecto, que es un render en cascada y lo que el linter de React marca. Ésta es la API que React
// documenta exactamente para esto: leer un sistema externo con soporte de SSR.
//
// Y SALE GRATIS UNA COSA MÁS: el evento `storage` avisa cuando OTRA pestaña cambia el valor, así
// que plegar el historial en una lo pliega en todas. Con el efecto habría que cablearlo aparte.

/** El valor del lado del servidor: no hay `window`, y ante la duda el panel se muestra. */
export function plegadoEnElServidor(): boolean {
  return false
}

export function leerPlegado(): boolean {
  try {
    return estaPlegado(window.localStorage.getItem(CLAVE_HISTORIAL_PLEGADO))
  } catch {
    // Incógnito con almacenamiento bloqueado: `localStorage` LANZA, no devuelve null. Sin esto la
    // barra entera se cae en esa ventana.
    return false
  }
}

/** Nombre del evento propio: `storage` sólo lo escuchan las OTRAS pestañas, no la que escribe. */
const EVENTO = "tuvetia:athos-historial-plegado"

export function escribirPlegado(plegado: boolean): void {
  try {
    window.localStorage.setItem(CLAVE_HISTORIAL_PLEGADO, valorAGuardar(plegado))
  } catch {
    // Se pliega igual en esta sesión; lo único que se pierde es que lo recuerde.
  }
  window.dispatchEvent(new Event(EVENTO))
}

export function suscribirAlPlegado(avisar: () => void): () => void {
  window.addEventListener("storage", avisar)
  window.addEventListener(EVENTO, avisar)
  return () => {
    window.removeEventListener("storage", avisar)
    window.removeEventListener(EVENTO, avisar)
  }
}
