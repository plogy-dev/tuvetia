"use client"

// El puente entre el cuaderno y React.
//
// Igual que `usar.ts` para la grabación: la lógica vive en `cuaderno.ts`, que es un `.ts` sin React
// y por eso testeable con vitest en `environment: "node"`. Acá sólo está la suscripción.

import { useCallback, useEffect } from "react"
import { useSyncExternalStore } from "react"

import { cuaderno, type EntradaDeCuaderno } from "./cuaderno"

export function useCuaderno(consultaId: string | null): EntradaDeCuaderno & {
  escribir: (texto: string) => void
} {
  const entrada = useSyncExternalStore(
    cuaderno.suscribir,
    // `leer` devuelve la MISMA referencia mientras nada cambie, que es lo que evita el bucle
    // infinito de `useSyncExternalStore`.
    useCallback(() => cuaderno.leer(consultaId), [consultaId]),
    cuaderno.leerEnServidor,
  )

  // Lectura inicial. El módulo la hace una sola vez por consulta, así que montar el cuaderno en dos
  // lugares no dispara dos consultas.
  useEffect(() => {
    if (consultaId) void cuaderno.cargar(consultaId)
  }, [consultaId])

  // Al desmontar —o al cambiar de consulta— se cancela la espera y se guarda lo pendiente. Es lo
  // que hace que minimizar el panel a mitad de una frase no pierda lo tecleado.
  //
  // Depende de `consultaId` y no de `[]`: con `[]` sólo corría al desmontar, y para entonces el id
  // ya era el de la consulta nueva. El cierre captura el id de su propio render, que es el que hay
  // que vaciar.
  useEffect(() => {
    return () => {
      if (!consultaId) return
      cuaderno.cancelarEspera(consultaId)
      void cuaderno.vaciar(consultaId)
    }
  }, [consultaId])

  const escribir = useCallback(
    (texto: string) => cuaderno.escribir(consultaId, texto),
    [consultaId],
  )

  return { ...entrada, escribir }
}
