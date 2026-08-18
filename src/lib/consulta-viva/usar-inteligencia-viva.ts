"use client"

// El puente entre la consulta que está pasando y Athos.
//
// QUÉ HACE: observa la transcripción en vivo y, cuando hay material nuevo, le pide a Athos notas
// (cada ~15 s) y sugerencias clínicas (cada ~45 s). Es el punto 3 del pedido del cliente:
//
//     Luciano: "la inteligencia de datos no tiene que estar solamente al finalizar la consulta,
//               sino durante la consulta"
//
// LA CADENCIA NO ESTÁ ACÁ, y no es un detalle de organización: vive en `disparador.ts` porque es una
// decisión de COSTO y tiene que poder probarse sin React. La aritmética está escrita ahí — a
// intervalo fijo, una consulta de 15 minutos gastaría 80 llamadas contra un tope de 1000 al mes.
//
// TRES COSAS QUE ESTE HOOK NO PUEDE HACER, y cada una tapa un fallo concreto:
//
//   1. **No dispara en pausa.** Si el vet pausó, no hay habla nueva que valga: lo que entró antes ya
//      se analizó, y lo que se dice mientras tanto no se está capturando.
//   2. **No solapa llamadas.** Sin el cerrojo, una respuesta lenta deja que el siguiente tick
//      dispare otra y el techo por consulta se cuenta mal — que es como se pierde el control del
//      gasto.
//   3. **No rompe la consulta.** Un fallo de red o del proveedor se traga en silencio: el vet está
//      atendiendo, y un toast de error por cada intento fallido cada 15 segundos es peor que no
//      tener la función.

import { useEffect, useRef, useState } from "react"

import { athosLive, type LiveResponse } from "@/lib/athos"
import {
  NOTAS,
  NUNCA,
  SUGERENCIAS,
  debeDisparar,
  trasDisparar,
  type Cadencia,
  type EstadoDisparo,
} from "@/lib/consulta-viva/disparador"
import { useConsultaViva } from "@/lib/consulta-viva/usar"

export type InteligenciaViva = {
  /** Las notas de lo que se dijo. Vacío mientras no haya material. */
  notas: string
  /** Qué preguntar, qué no dejar pasar, qué mirar. */
  sugerencias: string
  /** Alergias bloqueantes del paciente, para poder avisarlas antes de que el vet elija un fármaco. */
  alergias: string[]
  /** El guard de dosis tapó cifras: la ficha del paciente está incompleta. */
  dosisRedactadas: boolean
  /** Hay una petición en curso. Sirve para que el panel no parezca congelado. */
  pensando: boolean
  /** Cuántas llamadas lleva esta consulta, y cuántas admite. El techo se muestra, no se esconde. */
  llamadas: number
  techo: number
}

const VACIO: InteligenciaViva = {
  notas: "",
  sugerencias: "",
  alergias: [],
  dosisRedactadas: false,
  pensando: false,
  llamadas: 0,
  techo: NOTAS.maxPorConsulta + SUGERENCIAS.maxPorConsulta,
}

export function useInteligenciaViva(activo: boolean): InteligenciaViva {
  const estado = useConsultaViva()
  const [vivo, setVivo] = useState<InteligenciaViva>(VACIO)

  // Los contadores de cadencia van en refs y no en estado: cambian en cada tick y no se pintan, así
  // que meterlos en `useState` sería un re-render por segundo para nada.
  const disparos = useRef<Record<string, EstadoDisparo>>({
    [NOTAS.nombre]: NUNCA,
    [SUGERENCIAS.nombre]: NUNCA,
  })
  const enVuelo = useRef(false)
  const consultaRef = useRef<string | null>(null)

  const { fase, pausada, segundos, estable, consultaId, clinicId, pacienteId, motivo } = estado

  useEffect(() => {
    // Consulta nueva = cuenta nueva. Sin esto, los contadores de la consulta anterior dejarían a la
    // siguiente sin techo disponible.
    if (consultaId !== consultaRef.current) {
      consultaRef.current = consultaId
      disparos.current = { [NOTAS.nombre]: NUNCA, [SUGERENCIAS.nombre]: NUNCA }
      setVivo(VACIO)
    }
  }, [consultaId])

  useEffect(() => {
    if (!activo) return
    if (fase !== "grabando" || pausada) return
    if (!consultaId || !clinicId) return
    if (enVuelo.current) return

    // Las notas tienen prioridad: son lo barato y lo que el vet mira primero. Si las dos cadencias
    // caen en el mismo tick, la sugerencia espera al siguiente — no se disparan dos a la vez.
    const cadencia: Cadencia | null = debeDisparar(NOTAS, segundos, estable, disparos.current[NOTAS.nombre])
      ? NOTAS
      : debeDisparar(SUGERENCIAS, segundos, estable, disparos.current[SUGERENCIAS.nombre])
        ? SUGERENCIAS
        : null
    if (!cadencia) return

    // El texto se congela ACÁ. Si se leyera de nuevo al volver la respuesta, el contador de palabras
    // avanzaría con lo que se dijo mientras tanto y ese tramo no se analizaría nunca.
    const textoAnalizado = estable
    const momento = segundos

    enVuelo.current = true
    setVivo((v) => ({ ...v, pensando: true }))

    const corte = new AbortController()
    void athosLive({
      consultationId: consultaId,
      clinicId,
      patientId: pacienteId,
      transcript: textoAnalizado,
      motivo,
      modo: cadencia.nombre === SUGERENCIAS.nombre ? "sugerencias" : "notas",
      signal: corte.signal,
    })
      .then((r: LiveResponse) => {
        disparos.current[cadencia.nombre] = trasDisparar(
          momento,
          textoAnalizado,
          disparos.current[cadencia.nombre],
        )
        setVivo((v) => ({
          ...v,
          // `sin_material` NO borra lo que ya había: que este tramo no diera para nada no invalida
          // las notas de hace un minuto, y verlas desaparecer sería peor que no actualizarlas.
          notas: cadencia.nombre === NOTAS.nombre && !r.sin_material ? r.texto : v.notas,
          sugerencias:
            cadencia.nombre === SUGERENCIAS.nombre && !r.sin_material ? r.texto : v.sugerencias,
          alergias: r.alergias_severas.length ? r.alergias_severas : v.alergias,
          dosisRedactadas: v.dosisRedactadas || r.dosis_redactadas,
          pensando: false,
          llamadas:
            disparos.current[NOTAS.nombre].disparos + disparos.current[SUGERENCIAS.nombre].disparos,
        }))
      })
      .catch(() => {
        // EN SILENCIO, a propósito. El vet está atendiendo; un aviso de error cada quince segundos
        // es peor que la función que falla. Igual se cuenta el disparo: reintentar en bucle contra
        // un proveedor caído es la forma más cara de no arreglar nada.
        disparos.current[cadencia.nombre] = trasDisparar(
          momento,
          textoAnalizado,
          disparos.current[cadencia.nombre],
        )
        setVivo((v) => ({ ...v, pensando: false }))
      })
      .finally(() => {
        enVuelo.current = false
      })

    return () => corte.abort()
    // `segundos` es la dependencia que hace latir esto: cambia una vez por segundo y en cada tick se
    // vuelve a preguntar si toca. El disparador es quien decide, no este efecto.
  }, [activo, fase, pausada, segundos, estable, consultaId, clinicId, pacienteId, motivo])

  return vivo
}
