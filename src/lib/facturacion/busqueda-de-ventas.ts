// Lo que puede viajar dentro de un filtro `or=(…)` de PostgREST.
//
// ── POR QUÉ ESTO NO ES COSMÉTICO ──────────────────────────────────────────────────────────────
//
// El buscador del libro de ventas termina en `.or()`, y `.or()` NO recibe parámetros: recibe una
// CADENA que PostgREST parsea como gramática de filtros. Ahí dentro,
//
//   · la COMA separa condiciones — `a,b` son dos filtros unidos por OR;
//   · el PARÉNTESIS abre un grupo o la lista de un `in.(…)`;
//   · el PUNTO separa columna, operador y valor — `full_number.ilike.*x*`.
//
// Un término de búsqueda que conserve esos caracteres deja de ser texto a buscar y pasa a ser
// SINTAXIS: quien escribe en la caja estaría escribiendo parte de la consulta. No es SQL —PostgREST
// sigue parametrizando contra Postgres— pero sí alcanza para leer filas que el filtro de la clínica
// pretendía excluir, que para una lista de facturas es exactamente lo que no puede pasar.
//
// La defensa es una LISTA BLANCA y no una lista negra: se deja pasar sólo lo que un número de
// documento o un nombre necesitan —letras, dígitos, espacios, punto y guion— y se descarta todo lo
// demás. Una lista negra habría que ampliarla cada vez que alguien descubre otro carácter con
// significado; ésta no.
//
// El tope de 60 caracteres es de higiene: nadie busca una factura con un párrafo, y una URL con un
// término gigante sólo sirve para hacer trabajar a la base de más.

/** Deja el término en lo que se puede buscar sin que se vuelva sintaxis. */
export function terminoBuscable(v: string | undefined | null): string {
  return (v ?? '')
    .replace(/[^\p{L}\p{N} .\-]/gu, '')
    .trim()
    .slice(0, 60);
}
