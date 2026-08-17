import "server-only"

// CUÁNTO CUESTA PRO. Una sola variable de entorno, leída en un solo lugar.
//
// POR QUÉ EN CENTAVOS Y NO EN PESOS. Es la unidad con la que habla Wompi (`amount_in_cents`) y con
// la que ya trabaja todo el módulo de facturación de este repo. Convertir en el borde —una vez, acá—
// es más barato que tener dos unidades circulando y descubrir la confusión en un cobro real.
//
// POR QUÉ NO ES `NEXT_PUBLIC_`. El precio se muestra en pantalla, así que la tentación es exponerlo
// al navegador y leerlo desde el componente. No: el monto que se le manda a Wompi tiene que salir
// del SERVIDOR y de ningún otro lado. Con una `NEXT_PUBLIC_` habría dos fuentes —la que se pinta y
// la que se cobra— y bastaría con editar el bundle para intentar pagar otra cifra. Acá el servidor
// resuelve el número, lo baja como dato a la interfaz para que lo muestre, y vuelve a resolverlo
// por su cuenta cuando cobra. La interfaz nunca elige el monto.

/**
 * $200.000 COP al mes, en centavos.
 *
 * Es el valor con el que se arranca (~USD 50 al cambio de agosto de 2026) y está pensado para
 * cambiarse desde el entorno sin tocar código. El default existe para que un despliegue sin la
 * variable no cobre `0` ni reviente: cobra lo acordado.
 */
export const PRECIO_PRO_CENTAVOS_DEFAULT = 20_000_000

/**
 * El precio mensual de Pro, en centavos de peso.
 *
 * VALIDA EN VEZ DE CONFIAR. Un `Number(process.env.X)` suelto convierte `"200.000"` en `NaN` y
 * `""` en `0`; las dos cosas terminan en un cobro por cero pesos que Wompi rechaza con un error
 * que no dice nada del origen. Acá cualquier valor que no sea un entero positivo cae al default y
 * queda ruidoso en el log del servidor.
 */
export function precioProCentavos(): number {
  const raw = process.env.PLAN_PRO_PRECIO_CENTAVOS?.trim()
  if (!raw) return PRECIO_PRO_CENTAVOS_DEFAULT

  const n = Number(raw)
  if (!Number.isInteger(n) || n <= 0) {
    console.error(
      `PLAN_PRO_PRECIO_CENTAVOS inválido (${JSON.stringify(raw)}): se esperaba un entero de ` +
        `centavos, por ejemplo 20000000 para $200.000. Se usa el default.`,
    )
    return PRECIO_PRO_CENTAVOS_DEFAULT
  }
  return n
}
