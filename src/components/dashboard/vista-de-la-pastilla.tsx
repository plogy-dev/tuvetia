"use client"

// La vista rápida de una pastilla del tablero.
//
// LO QUE PIDIÓ EL CLIENTE, el 19-ago:
//
//   Luciano: "no que te full redireccione, sino que simplemente sea como una vista más directa…
//             como una sub página, sabes, como que sea la misma página pero una vista más directa"
//   Felipe:  "como un mini previo"
//
// LO OBVIO ERA NAVEGAR, y Luciano se adelantó a pedir que no. Tiene razón, y el motivo es el
// tablero mismo: la pregunta que dispara una cifra —"¿cuáles son esas nueve citas?"— dura dos
// segundos, y sacar al vet a la agenda le cuesta perder de vista todo lo demás que estaba mirando,
// que es justamente para lo que existe un tablero.
//
// EL ENLACE A LA SECCIÓN NO DESAPARECE, va un nivel abajo: queda al pie de la vista. Quien sólo
// quería mirar, mira y cierra; quien quiere trabajar sobre eso, entra. Si la tarjeta entera
// navegara, las dos cosas costarían lo mismo — y la barata es la que se pide casi siempre.

import { useEffect, useState } from "react"
import Link from "next/link"
import { ArrowRight, Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { bogotaDateTime } from "@/lib/date-utils"
import type { IdDeMetrica } from "@/lib/tablero/metricas"

// EL TIPO SALE DEL CATÁLOGO y ya no se escribe a mano acá. Eran dos listas de ids —ésta y la de
// `lib/tablero/metricas.ts`— y con dos listas, agregar una cifra y olvidarse de una compila igual y
// falla al hacer clic. Ahora agregar una métrica al catálogo obliga a darle destino abajo.
export type MetricaDelTablero = IdDeMetrica

type Fila = { id: string; titulo: string; detalle: string | null; cuando: string | null }

/** A dónde lleva cada fila, y a dónde lleva el "ver todo" del pie. */
const DESTINOS: Record<MetricaDelTablero, { fila: (id: string) => string; todo: string; verTodo: string }> = {
  "consultas-mes": {
    fila: (id) => `/dashboard/consultas/${id}`,
    todo: "/dashboard/consultas",
    verTodo: "Ver todas las consultas",
  },
  pacientes: {
    fila: (id) => `/dashboard/patients/${id}`,
    todo: "/dashboard/patients",
    verTodo: "Ver todos los pacientes",
  },
  "citas-7d": {
    fila: () => "/dashboard/calendario",
    todo: "/dashboard/calendario",
    verTodo: "Ver la agenda",
  },
  "notas-borrador": {
    fila: (id) => `/dashboard/consultas/${id}`,
    todo: "/dashboard/consultas?nota=draft",
    verTodo: "Ver los borradores",
  },

  // ── Las que se pueden agregar desde «Armá tu tablero» ────────────────────────────────────────
  "consultas-hoy": {
    fila: (id) => `/dashboard/consultas/${id}`,
    todo: "/dashboard/consultas",
    verTodo: "Ver todas las consultas",
  },
  // Las citas no tienen pantalla propia: la fila lleva a la agenda, igual que `citas-7d`.
  "citas-hoy": {
    fila: () => "/dashboard/calendario",
    todo: "/dashboard/calendario",
    verTodo: "Ver la agenda",
  },
  titulares: {
    fila: (id) => `/dashboard/owners/${id}`,
    todo: "/dashboard/owners",
    verTodo: "Ver todos los titulares",
  },
  "pacientes-nuevos-mes": {
    fila: (id) => `/dashboard/patients/${id}`,
    todo: "/dashboard/patients",
    verTodo: "Ver todos los pacientes",
  },
  // El refuerzo vive en la ficha del paciente, que es adonde hay que ir para agendarlo.
  "vacunas-por-vencer": {
    fila: (id) => `/dashboard/patients/${id}`,
    todo: "/dashboard/patients",
    verTodo: "Ver todos los pacientes",
  },
  "facturado-mes": {
    fila: (id) => `/dashboard/facturacion/${id}`,
    todo: "/dashboard/facturacion",
    verTodo: "Ver la facturación",
  },
  "por-cobrar": {
    fila: (id) => `/dashboard/facturacion/${id}`,
    todo: "/dashboard/facturacion/cartera",
    verTodo: "Ver la cartera",
  },
}

export function VistaDeLaPastilla({
  metrica,
  titulo,
  abierta,
  alCerrar,
}: {
  metrica: MetricaDelTablero
  titulo: string
  abierta: boolean
  alCerrar: () => void
}) {
  const [filas, setFilas] = useState<Fila[] | null>(null)
  const [error, setError] = useState(false)

  // SE PIDE AL ABRIR, no con el tablero. Son cuatro listas que casi nunca se miran: traerlas
  // siempre serían cuatro consultas más en cada carga para responder preguntas que nadie hizo.
  //
  // TODO EL `setState` VA EN UN `.then`, incluido el reset. Es el patrón que React documenta para
  // efectos —"suscribirse a un sistema externo y llamar a setState en un callback"— y es lo único
  // que deja al linter ver que el cuerpo síncrono no toca el estado. Poner `setFilas(null)` en el
  // cuerpo es un render en cascada garantizado: corre dentro del render que abrió el diálogo.
  useEffect(() => {
    if (!abierta) return
    const corte = new AbortController()
    Promise.resolve()
      .then(() => {
        setFilas(null)
        setError(false)
        return fetch(`/api/tablero/detalle?metrica=${metrica}`, { signal: corte.signal })
      })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status))
        return r.json() as Promise<{ filas: Fila[] }>
      })
      .then((r) => setFilas(r.filas))
      .catch((e) => {
        if ((e as Error)?.name !== "AbortError") setError(true)
      })
    return () => corte.abort()
  }, [abierta, metrica])

  const destino = DESTINOS[metrica]

  return (
    <Dialog open={abierta} onOpenChange={(v) => !v && alCerrar()}>
      <DialogContent className="max-w-lg gap-0 p-0">
        <DialogHeader className="border-b border-line-soft p-5 pb-4">
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            Un vistazo, sin salir del tablero. Tocá una fila para abrirla.
          </DialogDescription>
        </DialogHeader>

        <div className="flex max-h-[50svh] flex-col gap-0.5 overflow-y-auto p-2">
          {filas === null && !error && (
            <p className="flex items-center gap-2 px-3 py-6 text-sm text-fg-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Cargando…
            </p>
          )}

          {error && (
            <p className="px-3 py-6 text-sm text-fg-muted">
              No se pudo cargar el detalle. Podés{" "}
              <Link href={destino.todo} className="text-brand-text hover:underline" onClick={alCerrar}>
                abrir la sección
              </Link>{" "}
              en su lugar.
            </p>
          )}

          {filas?.length === 0 && (
            <p className="px-3 py-6 text-sm text-fg-muted">No hay nada acá todavía.</p>
          )}

          {filas?.map((f) => (
            <Link
              key={f.id}
              href={destino.fila(f.id)}
              onClick={alCerrar}
              className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-fg">{f.titulo}</span>
                {f.detalle && (
                  <span className="block truncate text-xs text-fg-muted">{f.detalle}</span>
                )}
              </span>
              {f.cuando && (
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-fg-faint">
                  {bogotaDateTime(f.cuando)}
                </span>
              )}
            </Link>
          ))}
        </div>

        {/* El enlace a la sección BAJA acá en vez de ser toda la tarjeta: quien sólo quería mirar,
            mira y cierra; quien quiere trabajar sobre eso, entra. */}
        <div className="border-t border-line-soft p-3">
          <Link
            href={destino.todo}
            onClick={alCerrar}
            className="flex items-center gap-1.5 rounded-[7px] px-2 py-1.5 text-[13px] font-medium text-brand-text hover:underline"
          >
            {destino.verTodo}
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  )
}
