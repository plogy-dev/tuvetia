"use client"

import * as React from "react"

import type { Capacidad, Plan } from "@/lib/planes"
import { tieneAcceso } from "@/lib/planes"

// El plan de la clínica, disponible en cualquier componente de cliente.
//
// POR QUÉ UN CONTEXTO Y NO UNA CONSULTA. Los dos lugares donde hay que frenar al vet —el compositor
// de VetGPT y el botón de iniciar consulta— están hundidos en el árbol y son de cliente. Con una
// consulta propia, cada uno haría su round-trip y, peor, tendría un instante de "no sé todavía" en
// el que el botón responde como si el plan alcanzara.
//
// Acá el plan viaja resuelto desde el layout del dashboard, que YA lee la clínica: el dato llega
// con el primer render y no cuesta una consulta más.
//
// ESTO NO ES EL GATE. Es la interfaz decidiendo qué mostrar. El corte real está en las rutas de API
// y en el trigger de `consultations`; si alguien edita este contexto desde la consola, lo único que
// consigue es que la ventana no se abra y que el servidor le responda 402.

export type ContextoDelPlan = {
  plan: Plan
  /** El precio mensual de Pro en centavos, resuelto por el servidor. Sólo para mostrarlo. */
  precioCentavos: number
  /** Si el usuario es administrador. Sólo él puede contratar. */
  esAdmin: boolean
}

const Ctx = React.createContext<ContextoDelPlan>({
  // El default es free por lo mismo que en el servidor: ante la duda, negar. Un componente montado
  // fuera del provider —una pantalla nueva, un test— muestra la invitación a Pro en vez de dejar
  // pasar en silencio.
  plan: "free",
  precioCentavos: 0,
  esAdmin: false,
})

export function PlanProvider({
  plan,
  precioCentavos,
  esAdmin,
  children,
}: ContextoDelPlan & { children: React.ReactNode }) {
  // `useMemo` con las tres primitivas como deps: sin él, cada render del layout crea un objeto
  // nuevo y re-renderiza a todos los consumidores, que incluyen el compositor de VetGPT.
  const valor = React.useMemo(
    () => ({ plan, precioCentavos, esAdmin }),
    [plan, precioCentavos, esAdmin],
  )
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export function usePlan(): ContextoDelPlan {
  return React.useContext(Ctx)
}

/**
 * `[puede, plan]` para una capacidad concreta.
 *
 * Devuelve también el contexto entero porque quien pregunta "¿puede?" casi siempre necesita después
 * el precio para pintar la ventana, y si no lo devolviera acá terminaría llamando a los dos hooks.
 */
export function useCapacidad(capacidad: Capacidad): ContextoDelPlan & { puede: boolean } {
  const ctx = usePlan()
  return { ...ctx, puede: tieneAcceso(ctx.plan, capacidad) }
}
