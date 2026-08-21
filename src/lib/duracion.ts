// Cuánto lleva la consulta, como reloj.
//
// EL DEFECTO. Estaba escrito CUATRO veces —el notch, el cockpit, el grabador de la consulta y el
// reproductor del audio guardado— y las cuatro con el mismo bug: minutos sin tope. A la hora y
// media el cronómetro mostraba `88:29`, que no se lee como un reloj sino como un error de render.
// Aparecio en una captura del 21-ago y era exactamente eso.
//
// NO ES UN CASO RARO. Una consulta larga con un titular que se va a buscar el carnet, o —más
// probable— una grabación que quedó abierta porque nadie la cerró: desde que la sesión sobrevive la
// navegación, pasar de una hora es lo normal, no la excepción. Y justamente en ese caso el número
// tiene que ser legible, porque es la señal de "esto lleva demasiado rato abierto".
//
// LAS HORAS NO SE RELLENAN CON CERO y los minutos sí: `1:05:30`, no `01:05:30`. Es la convención de
// cualquier reproductor, y el cero de más hace que el número se lea como una marca de tiempo de
// video largo cuando casi siempre va a ser una hora sola.
//
// Puro: `vitest.config.mts` corre en `environment: "node"`.

const dosCifras = (n: number) => String(n).padStart(2, "0")

/**
 * Segundos como reloj: `MM:SS` hasta la hora, `H:MM:SS` a partir de ahí.
 *
 * ENTRADA SUCIA → `00:00`. Un `NaN` —de una resta contra una fecha que no parseó, o de un
 * `duration` que el navegador todavía no calculó— produciría `NaN:NaN` en la cara del vet. Cero es
 * mentira sólo por un instante; `NaN:NaN` parece la app rota.
 */
export function comoReloj(total: number | null | undefined): string {
  if (typeof total !== "number" || !Number.isFinite(total) || total < 0) return "00:00"

  const entero = Math.floor(total)
  const h = Math.floor(entero / 3600)
  const m = Math.floor((entero % 3600) / 60)
  const s = entero % 60

  return h > 0 ? `${h}:${dosCifras(m)}:${dosCifras(s)}` : `${dosCifras(m)}:${dosCifras(s)}`
}
