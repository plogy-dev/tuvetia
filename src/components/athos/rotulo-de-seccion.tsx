// El rótulo de una sección del panel del Modo Fantasma.
//
// EL DEFECTO QUE ARREGLA. El mismo rol —"cómo se llama este bloque"— estaba pintado de DOS maneras
// dentro del mismo panel de 540px:
//
//   · "Qué mirar" y "Casos parecidos"  →  `text-sm font-semibold`, o sea 14px, el mismo tamaño que
//     el texto del bloque que encabezan.
//   · "Athos en vivo" (bloques) y "Mi cuaderno"  →  versalita de 11px.
//
// Un rótulo del mismo tamaño que su contenido no es un rótulo: es otra línea de texto. Eso es lo
// que `docs/entrega/4-EL-REPO-DE-LUCIANO.md` llamó "escala mucho más plana" que la del prototipo —
// no que nos falte texto chico, sino que el mismo rol se resuelve de dos formas y ninguna separa
// jerarquía del cuerpo.
//
// ── POR QUÉ 10px, Y POR QUÉ NO TODO ENCOGE ──────────────────────────────────────────────────────
//
// 10px con `tracking-[0.1em]` es la medida de su `Notch.tsx`, donde es el tamaño más usado (15 de
// sus rótulos). En mayúsculas y con letterspacing se lee sin esfuerzo, y bajar de 11 a 10 AUMENTA
// el contraste contra el cuerpo de 13px — que es el punto: hierarchy, no letra chica.
//
// Y ES LO ÚNICO QUE BAJA. El cronómetro de la pastilla, los mensajes de error y la línea que avisa
// que se está grabando se quedan donde están, aunque el prototipo los tenga más chicos: el primero
// se mira de reojo desde lejos, el segundo es un error —encogerlo es esconderlo—, y el tercero es
// una advertencia de consentimiento. Copiar la escala donde el rol no lo aguanta sería copiarla mal.

import { Loader2 } from "lucide-react"

/** La clase, para los rótulos que ya viven dentro de su propia estructura. */
export const ROTULO_DE_SECCION =
  "text-[10px] font-semibold uppercase tracking-[0.1em] text-fg-faint"

/**
 * Rótulo con icono, y con sitio a la derecha para lo que la sección necesite —un contador de gasto,
 * un botón de recargar—. La fila existe porque las tres secciones la repetían idéntica.
 */
export function RotuloDeSeccion({
  icono,
  children,
  cargando,
  acciones,
}: {
  icono?: React.ReactNode
  children: React.ReactNode
  /** Pinta el spinner al lado del rótulo, que es donde las tres lo tenían. */
  cargando?: boolean
  /** Va pegado a la derecha (`ml-auto` lo pone quien lo pasa, para no imponerlo). */
  acciones?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      {icono}
      <h3 className={ROTULO_DE_SECCION}>{children}</h3>
      {cargando && <Loader2 aria-hidden className="size-3 shrink-0 animate-spin text-fg-faint" />}
      {acciones}
    </div>
  )
}
