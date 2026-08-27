// Un rato, dicho como lo diría una persona.
//
// ── POR QUÉ HACE FALTA ─────────────────────────────────────────────────────────────────────────
//
// «Hoy» mostraba el hueco libre en minutos crudos. Con una jornada de 8 a 18 y la agenda vacía eso
// da «600 minutos libres», que es una cifra que nadie sabe leer de un vistazo: hay que dividir por
// sesenta para entender que es el día entero. Reportado el 27-ago con la captura de la agenda.
//
// El caso corto —«40 minutos libres»— sí se leía bien, y por eso el defecto sobrevivió: sólo
// aparece cuando el hueco es grande, que es justo cuando la clínica está vacía y menos ganas hay de
// mirar el número.
//
// PURO Y SIN RED: `vitest.config.mts` corre en `environment: "node"` sobre `src/**/*.test.ts`.

/**
 * Los minutos, en palabras.
 *
 * Devuelve la unidad más grande que no pierda información: minutos por debajo de la hora, horas
 * cuando son exactas, y las dos cuando hay resto. El resto NO se redondea — «1 h 50 min» dicho como
 * «2 horas» es media hora de más en una agenda, y esto se usa para ofrecerle un turno a un titular.
 */
export function duracionLegible(minutos: number): string {
  if (!Number.isFinite(minutos)) return "—"
  const total = Math.max(0, Math.round(minutos))

  if (total === 0) return "0 minutos"
  if (total < 60) return `${total} ${total === 1 ? "minuto" : "minutos"}`

  const horas = Math.floor(total / 60)
  const resto = total % 60

  // «1 hora» y no «1 horas»: el singular es la mitad de los casos de una agenda de media jornada.
  const enHoras = `${horas} ${horas === 1 ? "hora" : "horas"}`
  if (resto === 0) return enHoras

  // Con resto se abrevia. «1 hora y 30 minutos» ocupa el doble y esto vive en una línea angosta,
  // al lado de la hora de inicio y de un botón.
  return `${horas} h ${resto} min`
}
