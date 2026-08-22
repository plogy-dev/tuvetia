"use client"

// El cuaderno de la consulta.
//
// Es lo que el cliente pidió cuando dijo que el Modo Fantasma tenía que funcionar "como una especie
// de cuaderno": un lugar donde el veterinario escriba MIENTRAS atiende. Hasta ahora no existía —
// el panel era de sólo lectura y los únicos campos de texto del flujo se llenaban antes de empezar
// (`chief_complaint`) o después de que el modelo redactara (el SOAP).
//
// LO QUE SE ESCRIBE ACÁ NO ES LA NOTA. Es material de trabajo: se guarda con la consulta y entra
// como insumo cuando se redacta el SOAP, junto con la transcripción. Nunca entra solo a la
// historia clínica — eso sigue pasando por el gate de alergia y por la aprobación del vet.

import { useCuaderno } from "@/lib/consulta-viva/usar-cuaderno"
import { type EstadoDelCuaderno } from "@/lib/consulta-viva/cuaderno"
import { ROTULO_DE_SECCION } from "@/components/athos/rotulo-de-seccion"
import { Textarea } from "@/components/ui/textarea"

/**
 * El aviso de guardado.
 *
 * "Guardando…" NO se muestra: en una red normal dura milisegundos y produce un parpadeo constante
 * mientras se escribe, que es exactamente el tipo de ruido que hace que la gente deje de leer los
 * avisos. Sólo se dicen las dos cosas que importan — quedó guardado, o no se pudo.
 */
function Aviso({ estado }: { estado: EstadoDelCuaderno }) {
  if (estado === "error") {
    return (
      <span className="text-[11px] text-danger">
        No se pudo guardar. Lo escrito no se pierde: se reintenta solo.
      </span>
    )
  }
  if (estado === "guardado") {
    return <span className="text-[11px] text-fg-faint">Guardado</span>
  }
  return null
}

export function Cuaderno({
  consultaId,
  filas = 6,
  className,
}: {
  /** La consulta a la que pertenece esta página del cuaderno. */
  consultaId: string | null
  filas?: number
  className?: string
}) {
  const { texto, escribir, estado } = useCuaderno(consultaId)

  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={ROTULO_DE_SECCION}>
          Cuaderno
        </span>
        <Aviso estado={estado} />
      </div>
      <Textarea
        value={texto}
        onChange={(e) => escribir(e.target.value)}
        rows={filas}
        disabled={!consultaId}
        // El placeholder dice PARA QUÉ sirve, no "escribe algo". Un cuadro de texto en blanco en
        // medio de una consulta no se usa si no está claro qué se espera que entre.
        placeholder="Lo que anotarías en papel: peso, hallazgos, qué pedir, qué recordar. Entra como insumo de la nota."
        aria-label="Cuaderno de la consulta"
        className="resize-y text-sm leading-relaxed"
      />
      <p className="text-[11px] text-fg-muted">
        Es material de trabajo, no la nota clínica: se guarda con la consulta y Athos lo tiene en
        cuenta al redactar el SOAP, que igual revisas y apruebas.
      </p>
    </div>
  )
}
