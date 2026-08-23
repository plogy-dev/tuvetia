import "server-only"

// Cronómetro de fases para un componente de servidor.
//
// ── POR QUÉ EXISTE, Y POR QUÉ ACÁ Y NO EN EL COMPONENTE ───────────────────────────────────────
//
// `performance.now()` es una lectura impura, y `react-hooks/purity` la rechaza dentro de un
// componente — con razón: el compilador de React puede reordenar o memoizar, y una función que
// devuelve algo distinto en cada llamada rompe esa suposición. En un componente de SERVIDOR que se
// renderiza una vez por request no hay riesgo real, pero silenciar la regla en cinco líneas para
// código temporal es peor que mover la impureza a un módulo que la declara y la encapsula.
//
// ── PARA QUÉ SE USÓ ───────────────────────────────────────────────────────────────────────────
//
// El dashboard tiene un piso de ~800 ms por navegación que no son los datos de cada página: una
// pantalla SIN consultas cuesta lo mismo que la más pesada. La primera tanda de optimización estimó
// que quitar dos viajes de red bajaría 300-400 ms y bajó 100 — o sea que el modelo mental de dónde
// estaba el costo era incorrecto. Esto es el instrumento para dejar de adivinar.
//
// ── CÓMO SE LEE ───────────────────────────────────────────────────────────────────────────────
//
// Se activa con la cabecera `x-perf: 1`, que ningún navegador manda solo. Un usuario real nunca
// entra por ese camino. Los números salen en un nodo oculto que aparece en el payload RSC, así que
// se leen con un `fetch` desde la consola del navegador.

export type Marcas = {
  /** Anota cuánto pasó desde `desde`, en ms. No hace nada si la medición está apagada. */
  marcar: (etiqueta: string, desde: number) => void
  /** El reloj, para abrir una fase. */
  ahora: () => number
  /** Todo junto, listo para un atributo: `sesion=120;perfil=95;…`. */
  texto: () => string
}

/**
 * Un cronómetro apagado no cuesta nada: `ahora()` devuelve 0 y `marcar()` no anota. Así el camino
 * de un usuario real no paga ni la lectura del reloj.
 */
export function crearMarcas(activo: boolean): Marcas {
  if (!activo) {
    return { marcar: () => {}, ahora: () => 0, texto: () => "" }
  }
  const partes: string[] = []
  return {
    ahora: () => performance.now(),
    marcar: (etiqueta, desde) => partes.push(`${etiqueta}=${Math.round(performance.now() - desde)}`),
    texto: () => partes.join(";"),
  }
}
