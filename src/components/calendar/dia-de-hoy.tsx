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
    // `py-2.5` y no `py-4`: cada fila medía 53 px y un día de 6 citas empujaba el calendario bajo
    // el pliegue en un portátil de 768 px. La lista sigue legible — es la densidad de las filas de
    // «Próximas citas» del tablero.
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm not-last:border-b not-last:border-line">
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
    // ── «HOY» CEDE ESPACIO; ES LO QUE EVITA EL SCROLL DE PÁGINA ─────────────────────────────────
    //
    // Reporte 26-ago: «la agenda está completamente desbordada y toca hacer scroll down». No era un
    // descuido, era un empate imposible: esta sección era `lg:shrink-0` —no cede nunca— y la grilla
    // de abajo tiene un piso de 420 px. Con la lista de «Hoy» llena, la suma no cabía en un
    // portátil y `appointment-calendar.tsx` lo daba por aceptado: «antes de dejar la grilla
    // inusable, se prefiere devolverle unos px de scroll a la página».
    //
    // La cuenta, a 768 px de alto: 48 de cabecera + 16 del inset + 64 de padding dejan 640 para la
    // columna. «Hoy» pedía hasta 271 (41 de su cabecera + 30svh de lista) y el calendario no baja
    // de ~484 (su barra + los 420). Son 771 contra 640 — desbordaba por 131 px, siempre.
    //
    // EL ARREGLO NO ES UN NÚMERO MÁGICO NUEVO, es dejar que flexbox resuelva. Quitando `shrink-0`
    // y poniendo un PISO propio (104 px, la cabecera y una fila), el algoritmo congela la grilla en
    // su mínimo —que es la parte que de verdad no puede achicarse— y le da a «Hoy» lo que sobre. En
    // una pantalla alta «Hoy» se ve entero; en un portátil se recorta a lo que quepa y el día
    // completo sigue estando a un scroll DE LA LISTA. Que es lo que esta sección ya prometía.
    <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-card lg:min-h-[104px]">
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-fg-faint">
          Hoy
        </span>
        <span className="text-[13px] text-fg-muted">
          {citas.length === 1 ? "1 cita" : `${citas.length} citas`}
          {huecos.length > 0 &&
            ` · ${huecos.length === 1 ? "1 espacio libre" : `${huecos.length} espacios libres`}`}
        </span>
      </div>

      {/* Techo + scroll propio: un día lleno (10+ filas entre citas y huecos) crecía sin límite y
          el calendario —lo que esta pantalla existe para mostrar— quedaba entero bajo el pliegue.
          El día se sigue viendo completo scrolleando LA LISTA, no la página.

          En `lg:` el techo deja de ser 30svh y pasa a ser LO QUE LE TOQUE a la sección: `flex-1` +
          `min-h-0` dentro de una sección que ya cede. Medir contra el viewport era el error de
          fondo — 30svh no sabe que la grilla de abajo ya reclamó 420 px. Fuera de `lg:` el techo
          fijo se queda, porque ahí la página scrollea a propósito y no hay nada que repartir. */}
      <div className="max-h-[30svh] overflow-y-auto lg:max-h-none lg:min-h-0 lg:flex-1">
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
      </div>
    </section>
  )
}
