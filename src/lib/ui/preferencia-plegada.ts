// "¿Esto estaba plegado?" — el mecanismo, una sola vez.
//
// POR QUÉ EXISTE. Es la tercera superficie que necesita acordarse de si el vet la dejó cerrada: el
// historial de Athos en la barra (#150), la posición del notch (#154) y ahora el riel de la clínica.
// Las tres resuelven lo mismo y ninguna es difícil — y por eso mismo empiezan a divergir: en
// `riel-clinica` ya había una cuarta versión con el `subscribe` en blanco, que no se entera si el
// valor cambia y por lo tanto no sincroniza entre pestañas.
//
// ── LAS TRES DECISIONES QUE VIENEN DE REGALO ────────────────────────────────────────────────────
//
//   1. **ANTE LA DUDA, ABIERTO.** Sin valor guardado, con basura, o con algo de una versión
//      anterior, la superficie se muestra. Es la falla barata: un panel abierto que no se quería se
//      cierra con un clic; uno plegado que sí se quería es una función que desapareció sin
//      explicación, y el usuario no tiene cómo recuperarla salvo limpiar el navegador.
//
//   2. **`useSyncExternalStore` Y NO `useState` + `useEffect`.** Las dos evitan el error de
//      hidratación —el servidor no tiene `window`—, pero la del efecto llama a `setState` dentro
//      del efecto, que es un render en cascada y lo que el linter de React marca. Ésta es la API
//      que React documenta para leer un sistema externo con soporte de SSR.
//
//   3. **Y SINCRONIZA ENTRE PESTAÑAS**, gratis: `storage` avisa de los cambios de las OTRAS y el
//      evento propio cubre la que escribe, porque a ésa `storage` no le llega.
//
// Puro salvo los tres accesos a `window`, que están aislados: `vitest.config.mts` corre en
// `environment: "node"` y la regla —qué crudo significa plegado— se prueba sin navegador.

/** Lo que se guarda. Dos valores y nada más: no hay estado intermedio que representar. */
export function valorAGuardar(plegado: boolean): string {
  return plegado ? "1" : "0"
}

/**
 * ¿Este crudo significa "plegado"?
 *
 * Sólo el `"1"` exacto. Cualquier otra cosa —null, `"true"`, un JSON de una versión anterior, lo
 * que escribió una extensión— es "abierto". Ver la decisión 1 de arriba.
 */
export function estaPlegado(crudo: string | null | undefined): boolean {
  return crudo === "1"
}

/** Lo que devuelve `preferenciaPlegada`: lo justo para un `useSyncExternalStore`. */
export type PreferenciaPlegada = {
  clave: string
  leer: () => boolean
  escribir: (plegado: boolean) => void
  suscribir: (avisar: () => void) => () => void
  /** Del lado del servidor no hay `window`, y ante la duda va abierto. */
  enElServidor: () => boolean
}

/**
 * Una preferencia de plegado, atada a su clave de `localStorage`.
 *
 * @param clave  El nombre bajo el que vive. Va con prefijo `tuvetia:` por convención de la casa.
 */
export function preferenciaPlegada(clave: string): PreferenciaPlegada {
  const evento = `${clave}:cambio`

  return {
    clave,

    leer() {
      try {
        return estaPlegado(window.localStorage.getItem(clave))
      } catch {
        // Incógnito con almacenamiento bloqueado: `localStorage` LANZA, no devuelve null. Sin esto
        // la superficie entera se cae en esa ventana.
        return false
      }
    },

    escribir(plegado) {
      try {
        window.localStorage.setItem(clave, valorAGuardar(plegado))
      } catch {
        // Se pliega igual en esta sesión; lo único que se pierde es que lo recuerde.
      }
      window.dispatchEvent(new Event(evento))
    },

    suscribir(avisar) {
      window.addEventListener("storage", avisar)
      window.addEventListener(evento, avisar)
      return () => {
        window.removeEventListener("storage", avisar)
        window.removeEventListener(evento, avisar)
      }
    },

    enElServidor: () => false,
  }
}
