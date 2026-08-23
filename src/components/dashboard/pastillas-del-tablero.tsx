"use client"

// Una fila de cifras que se abren en vista rápida al tocarlas.
//
// LA USAN DOS PANTALLAS: el tablero y Pacientes. Lo que pidió Luciano el 19-ago —"no que te full
// redireccione, sino una vista más directa"— vale igual en las dos, y tener dos copias del mismo
// diálogo con el mismo estado era la forma segura de que una se quedara atrás.
//
// POR QUÉ ES UN COMPONENTE DE CLIENTE Y LA PÁGINA NO. El tablero es un server component y así
// conviene que siga: sus siete consultas corren en el servidor y llegan pintadas. Lo único que
// necesita estado del navegador es cuál vista está abierta, y eso es esta isla — las cifras siguen
// llegando calculadas desde el servidor, acá sólo se dibujan.

import { useState } from "react"

import { StatCard } from "@/components/ui/stat-card"
import {
  VistaDeLaPastilla,
  type MetricaDelTablero,
} from "@/components/dashboard/vista-de-la-pastilla"

export type Pastilla = {
  metrica: MetricaDelTablero
  label: string
  value: string
  hint: string
}

export function PastillasDelTablero({
  pastillas,
  clase,
}: {
  pastillas: Pastilla[]
  /** La grilla la decide quien la usa: el tablero se acomoda solo, Pacientes va en 2×4. */
  clase?: string
}) {
  // DOS ESTADOS Y NO UNO. `abierta` gobierna el diálogo; `mirando` recuerda CUÁL se estaba mirando.
  // Con un solo estado en null al cerrar, el contenido se vaciaría a mitad de la animación de
  // salida y la vista se desarmaría en la cara del que la cierra.
  const [mirando, setMirando] = useState<Pastilla | null>(null)
  const [abierta, setAbierta] = useState(false)

  return (
    <>
      {/* `auto-fit` + `minmax(220px,1fr)` es la grilla del mockup: las tarjetas se acomodan solas
          según el ancho en vez de saltar de 2 a 4 columnas en un breakpoint fijo. */}
      <div
        className={
          clase ?? "grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]"
        }
      >
        {pastillas.map((p) => (
          <StatCard
            key={p.metrica}
            label={p.label}
            value={p.value}
            sub={p.hint}
            onVer={() => {
              setMirando(p)
              setAbierta(true)
            }}
          />
        ))}
      </div>

      {/* UNA SOLA INSTANCIA para las cuatro, no una por tarjeta: son cuatro diálogos que nunca
          pueden estar abiertos a la vez. */}
      {mirando && (
        <VistaDeLaPastilla
          metrica={mirando.metrica}
          titulo={mirando.label}
          abierta={abierta}
          alCerrar={() => setAbierta(false)}
        />
      )}
    </>
  )
}
