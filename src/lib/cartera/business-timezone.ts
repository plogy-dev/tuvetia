// Zona horaria del negocio (America/Bogota) — SOLO servidor.
//
// POR QUÉ EXISTE ESTE ARCHIVO
// Las ventanas de la Ley 2300 viven en `facturacion/domain/reminders.ts` y se evalúan con los
// getters LOCALES de Date (`getHours`, `getDay`). Eso es correcto solo si el proceso corre en la
// zona del negocio. En Vercel el runtime corre en **UTC**, así que la ventana 7:00–19:00 se leía
// como 7:00–19:00 UTC = **2:00–14:00 en Colombia**. Dos consecuencias, ambas reales:
//
//   · permitía despachar cobranzas a las 3 de la mañana hora local — justo lo que la ley prohíbe;
//   · bloqueaba de 14:00 a 19:00, que es horario perfectamente legal (5 h perdidas por día).
//
// Los tests no lo veían porque construyen las fechas con el mismo constructor local que el código:
// pasan igual en cualquier zona. Solo se manifiesta en producción.
//
// La corrección es anclar el PROCESO a la zona del negocio, no reescribir el dominio: así los
// getters locales significan lo que el dominio siempre asumió, `toISOString()` sigue produciendo el
// instante absoluto correcto, y los 29 tests de la ley quedan intactos.
//
// Node relee `process.env.TZ` en caliente (invalida su caché de zona), así que basta con asignarlo
// antes del primer cálculo. Importar este módulo PRIMERO en `scheduler.ts` lo garantiza.

export const BUSINESS_TIMEZONE = "America/Bogota"

process.env.TZ = BUSINESS_TIMEZONE

/** Offset real del proceso en minutos (Bogotá = UTC-5 fijo, sin horario de verano → 300). */
function currentOffsetMinutes(): number {
  return new Date().getTimezoneOffset()
}

/**
 * Falla ANTES de despachar si el proceso no quedó en la zona del negocio.
 *
 * Preferimos no enviar nada a enviar en el horario equivocado: un recordatorio que no sale se
 * reintenta en el siguiente barrido; una cobranza a las 3 a. m. es una infracción que no se
 * deshace. Por eso esto lanza en vez de degradar en silencio.
 */
export function assertBusinessTimezone(): void {
  const offset = currentOffsetMinutes()
  if (offset !== 300) {
    throw new Error(
      `Zona horaria del proceso incorrecta: se esperaba ${BUSINESS_TIMEZONE} (UTC-5, offset 300) ` +
        `y se obtuvo offset ${offset}. Las ventanas de la Ley 2300 se evaluarían corridas, así que ` +
        `el barrido de cartera se aborta. Definí TZ=${BUSINESS_TIMEZONE} en el entorno.`,
    )
  }
}
