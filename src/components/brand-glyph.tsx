// El glifo «chispa» de la marca Tuvetia.
//
// ── POR QUÉ VIVE SOLO ─────────────────────────────────────────────────────────────────────────
//
// Estaba dentro de `app-sidebar.tsx`, que es donde nació. Sale a su propio archivo porque ahora lo
// usan dos sitios: la cabecera de la barra y la burbuja de Athos. Un glifo de marca copiado en dos
// lugares es un glifo que un día se actualiza en uno solo.
//
// ── EL COLOR VIENE DE AFUERA, Y ESO NO ES UN CAPRICHO ─────────────────────────────────────────
//
// En la barra pinta con `var(--accent)` sobre el fondo de la barra. La burbuja de Athos es
// `bg-primary text-primary-foreground`: ahí el acento NO CONTRASTA — se vería un glifo apagado
// sobre menta, o directamente no se vería.
//
// Por eso el relleno es una prop, con `var(--accent)` por defecto. El defecto importa: es lo que
// hace que la barra lateral quede EXACTAMENTE igual que antes de extraer esto, y que este cambio
// sea invisible donde no se pidió que cambiara nada.
//
// En la burbuja se pasa `currentColor`, así hereda el `text-primary-foreground` del botón y sigue
// contrastando si mañana cambia el color de la marca — o si el modo oscuro invierte el par.

export function BrandGlyph({
  className,
  fill = "var(--accent)",
}: {
  className?: string
  /** `currentColor` cuando el fondo ya define el color del contenido (la burbuja de Athos). */
  fill?: string
}) {
  return (
    <svg width="21" height="21" viewBox="0 0 64 64" aria-hidden className={className}>
      <path
        fill={fill}
        fillRule="evenodd"
        d="M32 8a24 24 0 1 0 0.001 0Z M44 22a5 5 0 1 0 0.001 0Z"
      />
    </svg>
  )
}
