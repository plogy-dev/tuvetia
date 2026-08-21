"use client"

// El botón que abre el panel de armar el tablero.
//
// ES UNA ISLA DE CLIENTE MINÚSCULA a propósito: el tablero es un server component y así conviene
// que siga —sus nueve consultas corren en el servidor y llegan pintadas—. Lo único que necesita
// estado del navegador es si el panel está abierto.
//
// EL PANEL SE MONTA SÓLO AL ABRIR: trae dnd-kit consigo, y no hay razón para cargarlo en cada
// visita al tablero cuando personalizar se hace una vez y no se vuelve a tocar.

import { useState } from "react"
import dynamic from "next/dynamic"
import { SlidersHorizontal } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { Puesto } from "@/lib/tablero/widgets"
import type { PuestoDeMetrica } from "@/lib/tablero/metricas"

const PersonalizarTablero = dynamic(
  () => import("@/components/dashboard/personalizar-tablero").then((m) => m.PersonalizarTablero),
  { ssr: false },
)

export function BotonDePersonalizar({
  disposicion,
  metricas,
  facturacionActiva,
  clinicId,
}: {
  disposicion: Puesto[]
  /** Las cifras de la tira, con las apagadas incluidas (0073). */
  metricas: PuestoDeMetrica[]
  /** Sin facturación activa, las cifras de plata no se ofrecen. */
  facturacionActiva: boolean
  clinicId: string | null
}) {
  const [abierto, setAbierto] = useState(false)

  // Sin clínica no hay dónde guardar la preferencia, así que el botón no se ofrece: un botón que
  // abre un panel cuyo "Guardar" va a fallar es peor que no tenerlo.
  if (!clinicId) return null

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setAbierto(true)}>
        <SlidersHorizontal className="size-3.5" />
        Personalizar
      </Button>
      {abierto && (
        <PersonalizarTablero
          disposicion={disposicion}
          metricas={metricas}
          facturacionActiva={facturacionActiva}
          clinicId={clinicId}
          abierto={abierto}
          alCerrar={() => setAbierto(false)}
        />
      )}
    </>
  )
}
