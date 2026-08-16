// Cómo se le dice al veterinario cuánta literatura respalda una nota clínica.
//
// EL DEFECTO QUE ESTO CIERRA. La pantalla de la consulta decidía el rótulo CONTANDO CITAS:
//
//     {citations.length > 0 ? "Evidencia suficiente" : "Sin literatura citada"}
//
// El juez de evidencia de Athos devuelve tres bandas —`none`, `limited`, `sufficient`— y `limited`
// significa "la literatura recuperada NO cubre este cuadro; respondé declarándolo". Una nota
// `limited` con siete citas caía en la primera rama y se rotulaba **"Evidencia suficiente"**: lo
// contrario de lo que el juez concluyó.
//
// No es hipotético. Medido contra el principal el 2026-08-16: de 41 notas, una es `limited`, tiene
// 7 citas, **y está APROBADA** — o sea que entró a la historia clínica de un paciente con ese
// rótulo. La banda `none` acertaba de casualidad, porque ahí el conteo de citas coincide con el
// veredicto.
//
// El chat sí avisa de `limited` (emite un evento `warning` antes del primer token). La nota, que es
// la que se archiva, no. Este módulo iguala las dos superficies.
//
// Vive sin React para poder probarlo en vitest, que corre en `environment: "node"`.

/** Las tres bandas del juez de evidencia. Espeja el CHECK de `clinical_notes.evidence_level`. */
export type BandaDeEvidencia = "none" | "limited" | "sufficient"

export const BANDAS: readonly BandaDeEvidencia[] = ["none", "limited", "sufficient"]

/**
 * Normaliza lo que venga de la base o del servicio.
 *
 * La columna es `not null default 'sufficient'`, así que un valor ausente ya cae del lado optimista
 * por diseño del esquema. Acá se replica ese default a propósito y no se inventa uno más severo:
 * cambiarlo haría que toda nota vieja —anterior a que existiera la columna— apareciera de golpe
 * como dudosa, que es una afirmación que nadie hizo.
 */
export function bandaDeEvidencia(raw: unknown): BandaDeEvidencia {
  return (BANDAS as readonly string[]).includes(raw as string)
    ? (raw as BandaDeEvidencia)
    : "sufficient"
}

export type AvisoDeEvidencia = {
  /** Texto corto para la insignia de la cabecera. */
  etiqueta: string
  /** `null` cuando no hay nada que advertir. */
  advertencia: string | null
  /** Cuán fuerte se pinta. `neutral` no lleva advertencia. */
  tono: "neutral" | "atencion" | "grave"
}

/**
 * Qué mostrar para una banda.
 *
 * NO RECIBE EL NÚMERO DE CITAS, y es el punto entero de este módulo: el rótulo sale del veredicto
 * del juez y de nada más. Si vuelve a depender del conteo, vuelve el defecto.
 */
export function avisoDeEvidencia(banda: BandaDeEvidencia): AvisoDeEvidencia {
  switch (banda) {
    case "sufficient":
      return { etiqueta: "Evidencia suficiente", advertencia: null, tono: "neutral" }

    case "limited":
      return {
        etiqueta: "Evidencia limitada",
        advertencia:
          "La literatura recuperada no cubre bien este cuadro. Las citas respaldan partes de la " +
          "nota, no el conjunto: revisá el análisis y el plan con criterio propio antes de aprobar.",
        tono: "atencion",
      }

    case "none":
      return {
        etiqueta: "Sin evidencia suficiente",
        advertencia:
          "Athos no encontró literatura que respalde este cuadro y se abstuvo de citar antes que " +
          "inventar una fuente. La nota se redactó sólo a partir de la transcripción.",
        tono: "grave",
      }
  }
}

/**
 * ¿La nota necesita que el vet vea una advertencia antes de aprobarla?
 *
 * Se expone aparte del aviso porque la pregunta se hace en dos lugares —la cabecera y el bloque de
 * referencias— y duplicar la condición es como se desincronizan.
 */
export function requiereAdvertencia(banda: BandaDeEvidencia): boolean {
  return avisoDeEvidencia(banda).advertencia !== null
}
