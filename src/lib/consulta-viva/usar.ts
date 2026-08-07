"use client"

// El puente entre el singleton de la grabación y React.
//
// Está en su propio archivo para que `sesion.ts` siga siendo un `.ts` sin React y por lo tanto
// testeable con vitest, que en este repo corre en `environment: "node"` y sólo mira
// `src/**/*.test.ts`.
//
// `getServerSnapshot` es obligatorio: sin él, un componente que use esto revienta al renderizarse en
// el servidor. Devuelve siempre inactiva, que es la verdad — durante el render del servidor no hay
// ninguna grabación en curso.

import { useSyncExternalStore } from "react"

import { consultaViva, type EstadoConsultaViva } from "./sesion"

export function useConsultaViva(): EstadoConsultaViva {
  return useSyncExternalStore(
    consultaViva.suscribir,
    consultaViva.leer,
    consultaViva.leerEnServidor,
  )
}
