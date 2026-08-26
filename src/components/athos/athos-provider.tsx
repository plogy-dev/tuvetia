"use client"

// El contexto que hace que VetGPT sepa qué estás mirando, en cualquier pantalla.
//
// TRES DECISIONES QUE SON EL DISEÑO, no detalles:
//
// 1. EL VALOR SE MEMOIZA SOBRE `contexto` Y NADA MÁS. Este provider envuelve el dashboard entero, o
//    sea que cualquier estado mutable que viva acá re-renderiza toda la app cuando cambia.
//    `contexto` sólo cambia al navegar, que es justo cuando el árbol se re-renderiza igual: no se
//    paga nada.
//
// 2. EL ESTADO ABIERTO/CERRADO DEL WIDGET **NO** VIVE ACÁ. Vive en `AthosDock`, que es HERMANO de
//    `{children}`, no ancestro. Abrir el widget no re-renderiza ninguna pantalla. Por eso `abrir()`
//    es un emisor de módulo y no un `useState`: cualquier parte de la app puede pedir "abrí VetGPT"
//    sin que este provider tenga que guardar ese estado.
//
// 3. EL CRONÓMETRO DE LA GRABACIÓN TAMPOCO. Tick de 1/segundo dentro de esto sería el dashboard
//    entero re-renderizándose cada segundo durante toda una consulta.
//
// El `clinicId` llega por props desde `dashboard/layout.tsx`, que YA lo resolvió en el servidor:
// nada de lo que se monte acá necesita re-consultar `profiles`, que es lo que hacen hoy media docena
// de pantallas.

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"

import {
  derivarContexto,
  describirContexto,
  pacienteDelContexto,
  type AthosContexto,
} from "@/lib/athos-context/derivar"

type Valor = {
  contexto: AthosContexto
  /** Listo para el body de `/api/athos/agent`. Null en las pantallas sin paciente. */
  patientId: string | null
  /** "la ficha de un paciente" — para la etiqueta del widget. */
  descripcion: string
  /**
   * Null mientras no hay clínica resuelta. Pasa en el instante previo a que el layout redirija a
   * `/bienvenida`: el provider igual tiene que renderizar porque envuelve `{children}`, así que el
   * caso se modela en vez de mentir con una cadena vacía. Quien lo consuma decide qué hacer.
   */
  clinicId: string | null
  clinicName: string | null
}

const Ctx = createContext<Valor | null>(null)

export function AthosProvider({
  clinicId,
  clinicName,
  children,
}: {
  clinicId: string | null
  clinicName: string | null
  children: ReactNode
}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const valor = useMemo<Valor>(() => {
    // `useSearchParams` devuelve un ReadonlyURLSearchParams; `derivarContexto` sólo lee `.get`.
    const contexto = derivarContexto(pathname, searchParams as unknown as URLSearchParams)
    return {
      contexto,
      patientId: pacienteDelContexto(contexto),
      descripcion: describirContexto(contexto),
      clinicId,
      clinicName,
    }
  }, [pathname, searchParams, clinicId, clinicName])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

/**
 * Devuelve null fuera del provider en vez de lanzar.
 *
 * A propósito: el widget se monta sólo en `/dashboard`, y un componente compartido que también se
 * use en `/admin` o en la landing no tiene por qué reventar la página por no tener contexto de
 * clínica. Quien lo consuma decide qué hacer sin él.
 */
export function useAthosContexto(): Valor | null {
  return useContext(Ctx)
}
