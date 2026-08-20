// De quién es el horario que manda: el de la clínica o el de la persona.
//
// EL PROBLEMA QUE RESUELVE, dicho en la reunión del 17-ago a propósito de los correos que salían
// con la hora equivocada: *"lo manda desde su correo… el horario es el suyo y no es el mío"*. El
// sistema conocía UN horario por clínica y se lo aplicaba a todos, así que un vet que entra a las 2
// aparecía disponible a las 8 porque la clínica abre a las 8.
//
// LA REGLA, y es corta: si esta persona definió franjas PARA ESE DÍA, mandan las suyas. Si no, las
// de la clínica. `vet_id` nulo en la tabla = fila de la clínica (migración 0069).
//
// POR QUÉ EL REEMPLAZO ES POR DÍA Y NO EN BLOQUE. Si tener horario propio apagara el de la clínica
// toda la semana, cargar "los martes entro a las 2" dejaría a esa persona sin horario de miércoles
// a lunes — y eso nadie lo lee en la UI antes de que un titular se quede sin cupo. Día por día, lo
// que no definís lo sigue cubriendo la clínica, que es lo que cualquiera espera al escribir una
// excepción.
//
// PURO Y SIN RED, como `huecos.ts` y por la misma razón: `vitest.config.mts` corre en
// `environment: "node"` sobre `src/**/*.test.ts`, así que lo que quiera cobertura tiene que ser un
// `.ts` sin componentes. La consulta a la base trae las filas de los dos dueños de una vez; decidir
// cuáles mandan es esto, y se puede probar.

export type FranjaDeAlguien = {
  weekday: number
  opens_at: string
  closes_at: string
  slot_minutes?: number
  /** Nulo = de la clínica. */
  vet_id: string | null
}

/**
 * Las franjas que rigen para `vetId`, de un conjunto que mezcla las suyas y las de la clínica.
 *
 * `vetId` nulo o desconocido devuelve las de la clínica, que es lo correcto para todo lo que no
 * habla de una persona en particular: lo que se le responde a un titular por WhatsApp, o
 * "¿a qué hora abren?".
 */
export function franjasQueMandan<T extends FranjaDeAlguien>(filas: T[], vetId: string | null): T[] {
  const deLaClinica = filas.filter((f) => f.vet_id === null)
  if (!vetId) return deLaClinica

  const propias = filas.filter((f) => f.vet_id === vetId)
  // Los días que la persona sí definió. Sobre esos no manda la clínica ni aunque tenga franjas.
  const diasPropios = new Set(propias.map((f) => f.weekday))

  return [...propias, ...deLaClinica.filter((f) => !diasPropios.has(f.weekday))]
}

/**
 * ¿Esta persona tiene horario propio? Sirve para decirlo en la UI, que es la mitad del asunto: un
 * horario que reemplaza a otro en silencio es un horario que nadie audita.
 */
export function tieneHorarioPropio(filas: FranjaDeAlguien[], vetId: string | null): boolean {
  return vetId !== null && filas.some((f) => f.vet_id === vetId)
}
