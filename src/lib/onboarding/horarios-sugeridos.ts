// El horario que el onboarding propone, ya lleno, para que el vet lo confirme en vez de escribirlo.
//
// POR QUÉ EXISTE. La auditoría del 2026-08-16 midió el riel de configuración sobre las 15 clínicas
// del principal: **1 de 15 tenía horarios**. Y `lib/onboarding/progreso.ts` dice qué cuesta eso —
// "sin ellos Athos no puede ofrecer un espacio libre ni agendar nada". O sea que agendar, una de las
// dos capacidades insignia, estaba apagada en 14 de 15 cuentas. No por un fallo: porque el paso
// estaba fuera del wizard, en un riel pasivo y plegable que nadie completa.
//
// POR QUÉ ACÁ SÍ HAY UN DEFAULT Y EN EL CATÁLOGO NO. Un horario equivocado es visible e inofensivo:
// el vet lo ve en la agenda y lo corrige. Un PRECIO equivocado sale en una factura, que es un
// documento fiscal. Por eso `catalogo-sugerido.ts` no propone cifras y esto sí propone días y horas.
//
// MÓDULO PURO A PROPÓSITO: `vitest.config.mts` corre en `environment: "node"` y sólo mira
// `src/**/*.test.ts`. Lo que quiera cobertura tiene que ser un `.ts` sin React adentro.

/** Un día de atención. `weekday` sigue a la tabla: 0 = domingo. */
export type DiaSugerido = {
  weekday: number
  /** `HH:MM`, como lo escribe un `<input type="time">`. */
  opens_at: string
  closes_at: string
}

/**
 * Lunes a viernes 8:00–18:00 y sábado 8:00–12:00.
 *
 * No es una encuesta: es el horario que una veterinaria de barrio en Colombia reconoce como el suyo
 * o corrige en dos toques. Domingo queda fuera porque abrir domingo es la excepción, y proponerlo
 * haría que el caso común tuviera que BORRAR una fila — más trabajo que agregarla.
 */
export const HORARIO_SUGERIDO: readonly DiaSugerido[] = [
  { weekday: 1, opens_at: "08:00", closes_at: "18:00" },
  { weekday: 2, opens_at: "08:00", closes_at: "18:00" },
  { weekday: 3, opens_at: "08:00", closes_at: "18:00" },
  { weekday: 4, opens_at: "08:00", closes_at: "18:00" },
  { weekday: 5, opens_at: "08:00", closes_at: "18:00" },
  { weekday: 6, opens_at: "08:00", closes_at: "12:00" },
]

/** Los nombres de los días, indexados por `weekday`. 0 = domingo, como la tabla. */
export const NOMBRE_DEL_DIA = [
  "Domingo",
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
] as const

/** Duración del turno. Es el default de la tabla (`slot_minutes smallint not null default 30`). */
export const SLOT_POR_DEFECTO = 30

/**
 * ¿Este día se puede guardar?
 *
 * La tabla tiene `constraint clinic_hours_valid_range check (closes_at > opens_at)`. Sin esta
 * comprobación, un vet que pone 18:00–08:00 recibe un error de Postgres en crudo a mitad del
 * onboarding — el peor momento posible para mostrar la palabra "constraint".
 */
export function diaValido(d: DiaSugerido): boolean {
  if (!/^\d{2}:\d{2}$/.test(d.opens_at) || !/^\d{2}:\d{2}$/.test(d.closes_at)) return false
  if (d.weekday < 0 || d.weekday > 6) return false
  return d.closes_at > d.opens_at
}

/**
 * Las filas a insertar en `clinic_hours`, a partir de los días que el vet dejó marcados.
 *
 * DESCARTA LOS INVÁLIDOS EN VEZ DE LANZAR. El onboarding no es el lugar para abortar por un día mal
 * escrito: se guardan los cinco que están bien y el vet arregla el sexto en Configuración. Perder el
 * paso entero por una hora invertida sería exactamente el tipo de traba que este módulo existe para
 * quitar.
 */
export function filasDeHorario(
  clinicId: string,
  dias: readonly DiaSugerido[],
): { clinic_id: string; weekday: number; opens_at: string; closes_at: string; slot_minutes: number }[] {
  return dias.filter(diaValido).map((d) => ({
    clinic_id: clinicId,
    weekday: d.weekday,
    opens_at: d.opens_at,
    closes_at: d.closes_at,
    slot_minutes: SLOT_POR_DEFECTO,
  }))
}
