// "Hoy" — la agenda del día como LISTA, encima del calendario.
//
// El mockup dibuja la agenda así y sólo así: filas con hora en mono, paciente y estado. Nosotros
// tenemos `react-big-calendar`, que es más funcional —se arrastra, se ve la semana, se crea en un
// hueco— y no lo cambio por una lista.
//
// Pero la lista aporta dos cosas que la grilla no da:
//
//   1. EL DÍA DE UN VISTAZO, sin contar cuadraditos. Es la pregunta que un vet se hace veinte veces
//      al día y la grilla la contesta peor que seis renglones.
//   2. LOS HUECOS COMO FILA ACCIONABLE. En la grilla el vacío es ausencia de bloques: no se ve, no
//      se cuenta y no se puede tocar. Acá dice "40 minutos libres" y ofrece llenarlo. Es la idea
//      más útil del mockup en esta pantalla.

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { bogotaTimeOf } from "@/lib/date-utils"
import type { Hueco } from "@/lib/agenda/huecos"

export type CitaDeHoy = {
  id: string
  starts_at: string
  etiqueta: string
  estado: string
}

/** Estados que el vet lee como "todavía puede pasar algo". */
const ETIQUETA_ESTADO: Record<string, { texto: string; clase: string }> = {
  scheduled: { texto: "Sin confirmar", clase: "bg-warn-soft text-warn" },
  confirmed: { texto: "Confirmada", clase: "bg-brand-soft text-brand-text" },
  in_progress: { texto: "En curso", clase: "bg-brand-soft text-brand-text" },
}

/** Una fila: hora en mono con ancho FIJO, para que las horas formen columna. */
function Fila({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 px-5 py-4 text-sm not-last:border-b not-last:border-line">
      {children}
    </div>
  )
}

export function DiaDeHoy({ citas, huecos }: { citas: CitaDeHoy[]; huecos: Hueco[] }) {
  // Las citas y los huecos se intercalan por hora: una lista del día en la que el vacío aparece
  // donde está, no agrupado al final como una sección aparte.
  const filas = [
    ...citas.map((c) => ({ orden: bogotaTimeOf(c.starts_at), tipo: "cita" as const, cita: c })),
    ...huecos.map((h) => ({ orden: h.desde, tipo: "hueco" as const, hueco: h })),
  ].sort((a, b) => a.orden.localeCompare(b.orden))

  if (filas.length === 0) return null

  return (
    <section className="overflow-hidden rounded-xl border border-line bg-card">
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          Hoy
        </span>
        <span className="text-[13px] text-fg-muted">
          {citas.length === 1 ? "1 cita" : `${citas.length} citas`}
          {huecos.length > 0 &&
            ` · ${huecos.length === 1 ? "1 espacio libre" : `${huecos.length} espacios libres`}`}
        </span>
      </div>

      {filas.map((f) =>
        f.tipo === "cita" ? (
          <Fila key={f.cita.id}>
            <span className="w-12 shrink-0 font-mono text-[13px] tabular-nums text-fg-muted">
              {f.orden}
            </span>
            <span className="min-w-0 flex-1 truncate">{f.cita.etiqueta}</span>
            {ETIQUETA_ESTADO[f.cita.estado] && (
              <span
                className={`shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${ETIQUETA_ESTADO[f.cita.estado].clase}`}
              >
                {ETIQUETA_ESTADO[f.cita.estado].texto}
              </span>
            )}
          </Fila>
        ) : (
          <Fila key={`hueco-${f.hueco.desde}`}>
            <span className="w-12 shrink-0 font-mono text-[13px] tabular-nums text-fg-faint">
              {f.hueco.desde}
            </span>
            <span className="min-w-0 flex-1 truncate text-fg-muted">
              {f.hueco.minutos} minutos libres
            </span>
            {/* Deja la petición ESCRITA en el compositor de VetGPT, no la envía: el vet ve qué se va
                a pedir antes de que salga. Misma regla que "Resolverlo con VetGPT" del riel. */}
            <Button
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 px-2 text-xs"
              render={<Link href={`/dashboard/asistente?pedir=hueco&desde=${f.hueco.desde}&minutos=${f.hueco.minutos}`} />}
            >
              Ofrecerlo con VetGPT
            </Button>
          </Fila>
        ),
      )}
    </section>
  )
}
