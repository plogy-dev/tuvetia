"use client"

// "Estás grabando la consulta de Canela · 12:43" — visible en TODA la app.
//
// NO ES DECORACIÓN, ES EL CONTRAPESO. Desde que la grabación sobrevive la navegación, el vet puede
// tener el micrófono abierto mientras mira la agenda, una factura o la ficha de otro paciente. Sin
// un indicador permanente eso es un micrófono abierto que nadie ve — que es exactamente la crítica
// que esta función se merecería.
//
// Y la etiqueta NOMBRA AL PACIENTE a propósito: es la prueba visible, para el vet y para quien mire
// la pantalla, de que el alcance es UNA consulta y no la jornada entera.

import Link from "next/link"
import { Loader2, Mic, Square, TriangleAlert } from "lucide-react"

import { consultaViva } from "@/lib/consulta-viva/sesion"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import { Button } from "@/components/ui/button"

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

export function GrabacionPastilla() {
  const estado = useConsultaViva()

  if (estado.fase === "inactiva" || estado.fase === "terminada") return null

  const enCurso = estado.fase === "grabando"
  const cerrando = estado.fase === "subiendo" || estado.fase === "transcribiendo"
  const fallo = estado.fase === "perdida"

  return (
    <div
      role="status"
      // El nombre accesible es ESTÁTICO. El cronómetro va aria-hidden porque una región viva que
      // cambia cada segundo hace que el lector de pantalla anuncie la hora sin parar, y eso vuelve
      // la app inusable para quien lo necesita.
      aria-label={
        enCurso
          ? `Grabando la consulta${estado.pacienteNombre ? ` de ${estado.pacienteNombre}` : ""}`
          : cerrando
            ? "Guardando la grabación"
            : "La grabación falló"
      }
      className={`pointer-events-auto flex items-center gap-2 rounded-full border py-1.5 pl-3 pr-1.5 shadow-lg ${
        fallo ? "border-destructive/40 bg-destructive/10" : "border-line-soft bg-card"
      }`}
    >
      {enCurso && (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-red-500 motion-safe:animate-pulse"
        />
      )}
      {cerrando && <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-fg-faint" />}
      {fallo && <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-destructive" />}

      <span className="min-w-0 text-xs">
        {enCurso && (
          <>
            <span className="hidden sm:inline">Grabando</span>
            {estado.pacienteNombre && (
              <span className="font-medium"> {estado.pacienteNombre}</span>
            )}
            <span aria-hidden className="ml-1.5 tabular-nums text-fg-muted">
              {mmss(estado.segundos)}
            </span>
          </>
        )}
        {cerrando && <span className="text-fg-muted">Guardando…</span>}
        {fallo && <span className="text-destructive">{estado.error ?? "Falló la grabación"}</span>}
      </span>

      {estado.consultaId && (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-xs"
          render={<Link href={`/dashboard/consultas/${estado.consultaId}`} />}
        >
          Abrir
        </Button>
      )}

      {/* Detener sólo en escritorio. En móvil el botón queda al alcance del pulgar y un toque
          accidental corta una grabación clínica: ahí se detiene desde la consulta, a un toque de
          "Abrir". */}
      {enCurso && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void consultaViva.detener()}
          className="hidden h-7 shrink-0 px-2 text-xs sm:inline-flex"
        >
          <Square className="size-3" aria-hidden /> Detener
        </Button>
      )}

      {fallo && (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => consultaViva.reiniciar()}
          className="h-7 shrink-0 px-2 text-xs"
        >
          Entendido
        </Button>
      )}

      {enCurso && <Mic aria-hidden className="size-3.5 shrink-0 text-fg-faint sm:hidden" />}
    </div>
  )
}
