// Qué texto de un correo se le muestra al veterinario cuando lo abre.
//
// SIN `server-only` A PROPÓSITO, igual que `plantillas.ts`: lo usan las dos mitades. El adaptador
// del proveedor recorta el preview con la constante de acá, y la bandeja —que es un componente de
// cliente— decide con la función de acá si lo que tiene es el correo entero o apenas su comienzo.
// Si el recorte y la lectura no compartieran el mismo número, la advertencia mentiría en cuanto
// alguien cambiara uno de los dos.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────────────────────
//
// Reportado por un vet el 2026-08-22 —"el contenido de los correos no se renderiza completamente,
// no se puede leer la comunicación total"— y era exacto: el panel de lectura pintaba `preview`, el
// MISMO campo recortado a 200 caracteres que usa la lista de la izquierda. Abrir un correo no
// mostraba más de lo que ya se veía sin abrirlo.
//
// Lo llamativo es que el cuerpo completo YA viajaba en el mismo objeto. `CorreoNormalizado.cuerpo`
// se había agregado para que cartera pudiera clasificar la intención de una respuesta ("le
// transferí ayer, adjunto el soporte, ¿me confirman?" no entra en 200 caracteres) y el panel de
// lectura nunca se cambió. El dato estaba ahí, sin usar.
//
// EL FALLBACK NO ES DEFENSIVO POR SI ACASO: Graph (Outlook) a veces entrega sólo `bodyPreview` en
// un listado, y ahí `cuerpo` llega vacío o igual al preview. En ese caso hay que mostrar lo que hay
// Y DECIRLO, que es lo que la advertencia hace — pero sólo cuando corresponde, no siempre como
// antes.

/** A cuántos caracteres se recorta el preview en `composio/proveedores.ts`. */
export const LARGO_DEL_PREVIEW = 200

export type CuerpoLegible = {
  /** El texto a pintar. */
  texto: string
  /**
   * ¿Es el correo entero?
   *
   * `false` significa que hay que avisarle al vet que está viendo apenas el comienzo. No es lo
   * mismo que "vino vacío": un correo corto cuyo cuerpo coincide con el preview está COMPLETO, y
   * advertirle ahí sería ruido en el caso más común.
   */
  completo: boolean
}

/**
 * El texto que se muestra al abrir un correo, y si es todo.
 *
 * Prefiere el cuerpo completo. Cuando lo único disponible es el preview, se asume recortado sólo si
 * llegó al tope: por debajo de eso el proveedor entregó todo lo que había.
 */
export function cuerpoLegible(correo: {
  cuerpo?: string | null
  preview?: string | null
}): CuerpoLegible {
  const cuerpo = (correo.cuerpo ?? "").trim()
  const preview = (correo.preview ?? "").trim()

  if (cuerpo && cuerpo !== preview) return { texto: cuerpo, completo: true }

  const texto = cuerpo || preview
  return { texto, completo: texto.length < LARGO_DEL_PREVIEW }
}
