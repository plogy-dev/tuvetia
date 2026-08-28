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

/**
 * Suscripción SELECTIVA: re-renderiza sólo cuando cambia lo seleccionado (comparación `Object.is`),
 * no en cada emisión del store — que durante una grabación es UNA POR SEGUNDO (el cronómetro) más
 * una por resultado de voz. El selector debe devolver un primitivo o una referencia estable.
 *
 * Existe por la página de consulta: se suscribía entera sólo para derivar «¿esta consulta es la que
 * se está grabando?», y con una transcripción previa larga cargada re-parseaba todo el texto cada
 * segundo (auditoría 28-ago). Los suscriptores chicos (notch, pastilla, cockpit) están bien con el
 * hook completo — son subárboles acotados y diseñados para el tick.
 */
export function useConsultaVivaDerivado<T>(selector: (e: EstadoConsultaViva) => T): T {
  return useSyncExternalStore(
    consultaViva.suscribir,
    () => selector(consultaViva.leer()),
    () => selector(consultaViva.leerEnServidor()),
  )
}
