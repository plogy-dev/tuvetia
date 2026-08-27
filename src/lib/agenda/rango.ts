// El rango visible del calendario, normalizado para la CONSULTA de citas.
//
// react-big-calendar reporta el rango de dos formas: un objeto {start, end} (vista mes) o un
// ARRAY de fechas (semana y día) cuyo último elemento es la MEDIANOCHE del último día. Usar esa
// medianoche tal cual como fin del rango dejaba la consulta `starts_at <= fin` SIN las citas de
// ese último día. El caso extremo era la vista DÍA (array de UN elemento): el rango colapsaba al
// instante 00:00-00:00 y la recarga devolvía cero citas — «se desaparece la cita» (reporte del
// 27-ago). En semana, el mismo defecto se comía en silencio las citas del sábado.

export function normalizarRango(range: Date[] | { start: Date; end: Date }): {
  start: Date
  end: Date
} {
  if (Array.isArray(range)) {
    const fin = new Date(range[range.length - 1])
    fin.setHours(23, 59, 59, 999) // el último día COMPLETO, no su medianoche inicial
    return { start: range[0], end: fin }
  }
  return { start: range.start, end: range.end }
}
