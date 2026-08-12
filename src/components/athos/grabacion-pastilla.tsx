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

export function GrabacionPastilla({ alAbrir }: { alAbrir?: () => void }) {
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
        fallo ? "border-destructive/40 bg-destructive/10" : "border-brand bg-card"
      }`}
    >
      {enCurso && (
        // MENTA, NO ROJO. Lo tenía en `bg-red-500` con el argumento de que el rojo de grabación es
        // una convención de hardware y que `bg-danger` colisionaría con el estado de FALLO de esta
        // misma pastilla. El mockup del cliente resuelve el conflicto mejor: usa el MENTA, que en
        // este sistema es el color de "activo", y deja el rojo libre para lo que salió mal.
        //
        // Con eso desaparece la última clase de paleta cruda de la app, y la pastilla deja de
        // parecer una alerta cuando está haciendo exactamente lo que se le pidió.
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-brand motion-safe:animate-pulse"
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

      {/* "Abrir" ABRE EL PANEL, no navega. Antes mandaba a la pantalla de la consulta: mirar cómo va
          la transcripción obligaba a abandonar lo que estabas haciendo, que es exactamente lo que
          esta función existe para evitar. Ir a la consulta sigue estando, dentro del panel.

          Si el dock no pasó `alAbrir` —montado suelto en algún test o pantalla— cae al enlace de
          antes en vez de quedarse sin salida. */}
      {alAbrir ? (
        <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2 text-xs" onClick={alAbrir}>
          Abrir
        </Button>
      ) : (
        estado.consultaId && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-xs"
            render={<Link href={`/dashboard/consultas/${estado.consultaId}`} />}
          >
            Abrir
          </Button>
        )
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
