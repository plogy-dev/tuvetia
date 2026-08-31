// La rampa de calentamiento del modo automático, contada.
//
// El CÁLCULO vive en `auto-reply.ts:58-62` (5 respuestas/día el día 0, +5 por día conectado,
// hasta el límite configurado). Esta función lo espejea PURO para que la UI —la barra de
// autonomía— pueda mostrar el mismo número sin duplicar el reloj dentro de un componente
// (React Compiler marca `Date.now()` en render como impuro, con razón). Mismo patrón que
// `diasDePruebaRestantes` en `lib/planes`.
//
// Si el 5 cambia allá, cambia acá: hay un espejo en `barra-de-autonomia.tsx` que sólo lo cita.

const RAMPA_INICIAL = 5

/** Cuántas respuestas automáticas puede enviar hoy la clínica. `null` si falta algún dato. */
export function cupoDeHoy(
  connectedAt: string | null,
  limiteDiario: number | null,
  ahora = new Date(),
): number | null {
  if (!connectedAt || limiteDiario === null) return null
  const conectado = new Date(connectedAt).getTime()
  if (!Number.isFinite(conectado)) return null
  const dias = Math.max(0, Math.floor((ahora.getTime() - conectado) / 86_400_000))
  return Math.min(limiteDiario, RAMPA_INICIAL * (1 + dias))
}
