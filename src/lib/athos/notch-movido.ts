// Dónde dejó el vet el notch, y que se acuerde.
//
// LO QUE PIDIÓ LUCIANO, el 21-ago mirando el Modo Fantasma: *"que sea movible"*. El notch flota
// arriba y al centro del área de contenido, y ahí tapa lo que esté justo debajo — el título de la
// pantalla, la primera fila de una tabla, el encabezado de la agenda. Con la grabación sobreviviendo
// la navegación, eso es un objeto permanente encima de cualquier pantalla: si estorba, tiene que
// poder correrse.
//
// SE RECUERDA, y por lo mismo que el historial plegado: un notch que vuelve al centro en cada
// navegación no es movible, es un objeto que hay que correr una vez por página.
//
// ── EL DESPLAZAMIENTO ES RELATIVO, NO UNA COORDENADA ────────────────────────────────────────────
//
// `{x: 0, y: 0}` es "donde estaba": centrado sobre el contenido, debajo de la cabecera. Guardar la
// posición absoluta sería guardar una foto de un ancho de ventana concreto — al abrir el portátil
// con otra pantalla, o al plegar el sidebar, el notch aparecería en cualquier lado. Un delta contra
// el centro sobrevive los dos cambios porque el centro se recalcula solo.
//
// ── Y SE ACOTA AL LEER, NO SÓLO AL SOLTAR ───────────────────────────────────────────────────────
//
// Es la parte que parece de más y no lo es. Un desplazamiento guardado en una ventana ancha deja el
// notch FUERA de una angosta: invisible, y sin forma de recuperarlo salvo limpiar el navegador —
// justo el modo de falla que no puede tener algo que avisa que el micrófono está abierto.
//
// Puro y sin `window`: se le pasa el crudo y los límites ya medidos. Así se prueba, que es lo único
// que hace verificable la regla de "ante la duda, centrado".

export const CLAVE_NOTCH_MOVIDO = "tuvetia:notch-movido"

export type Desplazamiento = { x: number; y: number }

/** Donde el notch estaba antes de que existiera esto: centrado, bajo la cabecera. */
export const CENTRADO: Desplazamiento = { x: 0, y: 0 }

/**
 * Cuánto se puede correr en cada eje, ya medido contra el área de contenido.
 *
 * `x` es el máximo en VALOR ABSOLUTO —se puede ir para los dos lados—; `y` es sólo hacia abajo,
 * porque hacia arriba está la cabecera y meterlo debajo de ella es esconderlo.
 */
export type Limites = { x: number; y: number }

function esNumeroUsable(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v)
}

/**
 * El desplazamiento guardado.
 *
 * **ANTE LA DUDA, CENTRADO.** Sin valor, con JSON roto, con algo de una versión anterior o con un
 * `NaN`/`Infinity` que envenenaría el `transform`, el notch vuelve a donde siempre estuvo. Es la
 * falla barata: un notch centrado que alguien había corrido se vuelve a correr de un arrastre; uno
 * en una coordenada inválida no se pinta en ningún lado.
 */
export function leerDesplazamiento(crudo: string | null | undefined): Desplazamiento {
  if (!crudo) return CENTRADO
  try {
    const v = JSON.parse(crudo) as unknown
    if (!v || typeof v !== "object") return CENTRADO
    const { x, y } = v as Record<string, unknown>
    if (!esNumeroUsable(x) || !esNumeroUsable(y)) return CENTRADO
    return { x, y }
  } catch {
    return CENTRADO
  }
}

export function valorAGuardar(d: Desplazamiento): string {
  return JSON.stringify({ x: Math.round(d.x), y: Math.round(d.y) })
}

/**
 * El desplazamiento recortado a lo que cabe.
 *
 * Se aplica en los DOS momentos y por motivos distintos: al soltar, para que no se pueda dejar
 * afuera; al leer y al cambiar el tamaño de la ventana, para rescatar uno que ya quedó afuera.
 *
 * Con límites negativos —un área más chica que el propio notch, que pasa en pantallas mínimas— el
 * eje se fija en 0 en vez de invertirse: centrado es lo único sensato cuando no sobra espacio.
 */
export function acotar(d: Desplazamiento, limites: Limites): Desplazamiento {
  const topeX = Math.max(0, limites.x)
  const topeY = Math.max(0, limites.y)
  return {
    x: Math.min(topeX, Math.max(-topeX, d.x)),
    y: Math.min(topeY, Math.max(0, d.y)),
  }
}

/** ¿Está en su sitio de siempre? Sirve para no ofrecer "volver al centro" cuando ya está ahí. */
export function estaCentrado(d: Desplazamiento): boolean {
  return d.x === 0 && d.y === 0
}

// ── El almacén externo, para leerlo sin romper la hidratación ───────────────────────────────────
//
// Mismo mecanismo que `historial-plegado`: `useSyncExternalStore` y no `useState` + `useEffect`.
// Las dos evitan el error de hidratación —el servidor no tiene `window`—, pero la del efecto llama
// a `setState` dentro del efecto, que es un render en cascada. Y sale gratis que mover el notch en
// una pestaña lo mueva en las otras.

/** Del lado del servidor no hay `window`, y ante la duda el notch va centrado. */
export function centradoEnElServidor(): Desplazamiento {
  return CENTRADO
}

const EVENTO = "tuvetia:notch-movido"

/**
 * Lo guardado, ya parseado.
 *
 * DEVUELVE LA MISMA REFERENCIA mientras el crudo no cambie. `useSyncExternalStore` compara por
 * identidad: un objeto nuevo en cada lectura sería un bucle infinito de renders, no un bug sutil.
 */
let ultimoCrudo: string | null = null
let ultimoValor: Desplazamiento = CENTRADO

export function leerDelAlmacen(): Desplazamiento {
  let crudo: string | null = null
  try {
    crudo = window.localStorage.getItem(CLAVE_NOTCH_MOVIDO)
  } catch {
    // Incógnito con almacenamiento bloqueado: `localStorage` LANZA, no devuelve null.
    return CENTRADO
  }
  if (crudo !== ultimoCrudo) {
    ultimoCrudo = crudo
    ultimoValor = leerDesplazamiento(crudo)
  }
  return ultimoValor
}

export function escribirDesplazamiento(d: Desplazamiento): void {
  try {
    window.localStorage.setItem(CLAVE_NOTCH_MOVIDO, valorAGuardar(d))
  } catch {
    // Se mueve igual en esta sesión; lo único que se pierde es que lo recuerde.
  }
  window.dispatchEvent(new Event(EVENTO))
}

export function suscribirAlDesplazamiento(avisar: () => void): () => void {
  window.addEventListener("storage", avisar)
  window.addEventListener(EVENTO, avisar)
  return () => {
    window.removeEventListener("storage", avisar)
    window.removeEventListener(EVENTO, avisar)
  }
}
