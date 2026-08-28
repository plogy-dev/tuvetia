// Qué color de letra se lee sobre el bloque de una cita.
//
// ── EL FALLO, encontrado en la auditoría de UI del 27-ago ──────────────────────────────────────
//
// La grilla pintaba el texto del bloque en BLANCO FIJO (`calendar-chrome.tsx`, dos sitios) mientras
// el fondo lo elegía el tipo de cita. Eso funciona sólo si todos los fondos son oscuros, y no lo
// son:
//
//   · En claro, «Examen de laboratorio» e «Imágenes diagnósticas» usaban `--color-accent`, que no es
//     el acento de marca sino el hover de los menús: menta 100, casi blanco. Blanco sobre eso da
//     ~1.1:1 — la cita no se leía. (Ese token ya se cambió; el defecto de fondo es este.)
//   · En OSCURO se invierte y es PEOR, porque afecta a casi todos los tipos: `--color-brand` pasa a
//     menta 300 (#7ed0ba), `--color-ok` también, y `--color-warn` a #e5c078. Los tres son claros, y
//     encima de los tres se seguía escribiendo en blanco.
//
// O sea que no era un tipo mal pintado: era que el color de la letra no dependía del fondo.
//
// ── POR QUÉ SE RESUELVE EN CSS Y NO EN JAVASCRIPT ─────────────────────────────────────────────
//
// Los colores son TOKENS (`var(--color-brand)`), no hexadecimales, y cambian de valor entre tema
// claro y oscuro. Calcular la luminancia acá obligaría a resolver la variable contra el DOM en cada
// render y a rehacerlo al cambiar de tema.
//
// La sintaxis de color relativo lo hace el navegador, en el mismo lugar donde ya vive la decisión:
// `oklch(from <fondo> …)` toma la claridad `l` del fondo y decide con ella. Sin ganchos, sin
// medición, y correcto por construcción cuando alguien agregue un tipo nuevo o retoque la paleta.
//
// SI EL NAVEGADOR NO LA ENTIENDE no pasa nada malo: la declaración es inválida, se descarta, y el
// bloque se queda con el `color: #fff` que trae react-big-calendar en su propio CSS — exactamente lo
// que se veía hasta hoy. Es mejora progresiva, no una apuesta.

/**
 * El corte de claridad OKLCH a partir del cual conviene letra oscura.
 *
 * NO ES UN NÚMERO ELEGIDO A OJO. Se midió en Chrome contra los nueve tonos que esta grilla puede
 * pintar, comparando el contraste WCAG de blanco contra el de la tinta oscura sobre cada uno:
 *
 *   fondo                          L      blanco   oscura   elige
 *   brand claro  #3ec59b         0.740     2.17     9.66    oscura ✓
 *   danger claro #e0524a         0.628     3.84     5.47    oscura ✓
 *   warn claro   #8a5a0b         0.508     5.92     3.55    blanca ✓
 *   info         #3f6670         0.485     6.28     3.35    blanca ✓
 *   brand-deep   #1f7a5e         0.520     5.25     4.00    blanca ✓
 *   brand oscuro #7ed0ba         0.799     1.81    11.62    oscura ✓
 *   danger oscuro#d6584c         0.621     3.92     5.36    oscura ✓
 *   warn oscuro  #e5c078         0.824     1.73    12.14    oscura ✓
 *   info oscuro  #7fb0bd         0.727     2.37     8.85    oscura ✓
 *
 * Con 0.62 el interruptor elige la opción de MÁS contraste en los nueve. Con 0.70 se equivoca en los
 * dos rojos, que caen justo en la frontera. Y la columna «blanco» es el tamaño del defecto que esto
 * arregla: en tema oscuro la grilla escribía a 1.73:1 y 1.81:1, que no es «difícil de leer».
 *
 * De paso coincide con una decisión que el sistema ya había tomado a mano: «menta 500 pinta
 * RELLENOS y menta 700 es el que va en TEXTO» (`globals.css`). Menta 500 queda del lado oscuro del
 * corte, menta 700 del lado blanco.
 */
const CORTE = 0.62

/**
 * El color de letra que se lee sobre `fondo`, sea cual sea el tema.
 *
 * `fondo` es lo que ya se le pasa a `backgroundColor`: un `var(--color-…)` o cualquier color CSS.
 *
 * La cuenta: `(l - CORTE) * -1000` es enorme y positiva cuando el fondo es oscuro y enorme y
 * negativa cuando es claro; el `clamp` la aplasta a 1 (blanco) o a 0.15 (casi negro). No es un
 * degradado — es un interruptor escrito con las herramientas que hay dentro de un color.
 *
 * 0.15 en vez de 0 porque el negro puro no está en esta paleta: el grafito de la casa es #0c1613.
 */
export function tintaSobre(fondo: string): string {
  return `oklch(from ${fondo} clamp(0.15, (l - ${CORTE}) * -1000, 1) 0 0)`
}
