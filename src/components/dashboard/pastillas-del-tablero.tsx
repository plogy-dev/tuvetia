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
import {
  Banknote,
  CalendarClock,
  CalendarDays,
  FileClock,
  HandCoins,
  PawPrint,
  Stethoscope,
  Syringe,
  TrendingUp,
  Users,
} from "lucide-react"

import { StatCard } from "@/components/ui/stat-card"
import {
  VistaDeLaPastilla,
  type MetricaDelTablero,
} from "@/components/dashboard/vista-de-la-pastilla"

// El icono y el color de CADA cifra — el toque OkVet que pidió David (26-ago: «dashboard
// referente de OkVet, darle más vida»). Los tonos salen de la paleta categórica ya validada
// (`--chart-N`, ver globals.css) y son FIJOS por dominio, no por posición: lo clínico en menta,
// la agenda en azul, la gente en violeta, lo pendiente en ámbar y la plata en frambuesa —
// reordenar o apagar pastillas no le cambia el color a ninguna.
//
// Vive ACÁ y no en `lib/tablero/metricas.ts` a propósito: aquel módulo es puro y corre en los
// tests de node; los iconos son componentes de React y lo ensuciarían.
const ADORNO: Partial<Record<MetricaDelTablero, { icono: React.ReactNode; tono: string }>> = {
  "consultas-mes": { icono: <Stethoscope />, tono: "var(--chart-1)" },
  "consultas-hoy": { icono: <Stethoscope />, tono: "var(--chart-1)" },
  pacientes: { icono: <PawPrint />, tono: "var(--chart-3)" },
  "pacientes-nuevos-mes": { icono: <TrendingUp />, tono: "var(--chart-3)" },
  titulares: { icono: <Users />, tono: "var(--chart-3)" },
  "citas-7d": { icono: <CalendarDays />, tono: "var(--chart-5)" },
  "citas-hoy": { icono: <CalendarClock />, tono: "var(--chart-5)" },
  "notas-borrador": { icono: <FileClock />, tono: "var(--chart-2)" },
  "vacunas-por-vencer": { icono: <Syringe />, tono: "var(--chart-2)" },
  "facturado-mes": { icono: <Banknote />, tono: "var(--chart-4)" },
  "por-cobrar": { icono: <HandCoins />, tono: "var(--chart-4)" },
}

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
            icono={ADORNO[p.metrica]?.icono}
            tono={ADORNO[p.metrica]?.tono}
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
