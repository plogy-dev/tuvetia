"use client"

// El panel del Modo Fantasma: baja desde arriba y cubre la app, como en el mockup.
//
// LA IDEA QUE IMPLEMENTA. Grabar no te saca de donde estás. Es la mitad visual de lo que el PR #82
// ya construyó por dentro —la grabación sobrevive la navegación— y hasta ahora no tenía dónde verse:
// para mirar la transcripción en vivo había que volver a la pantalla de la consulta.
//
// POR QUÉ ESTO NO TOCA EL GRABADOR. `consultation-recorder.tsx` sigue siendo el único que pide el
// micrófono, el consentimiento y llama a `iniciar()`. Este panel sólo OBSERVA `consultaViva` con
// `useConsultaViva()`, exactamente como la pastilla. Es lo que habilita sacar el estado del árbol de
// React: un segundo observador no cuesta nada y no puede romper al primero.
//
// La única acción que ejecuta es `detener()`, que es la misma llamada que la pastilla ya hacía.
//
// LO QUE NO HACE, Y ES A PROPÓSITO. El mockup muestra la transcripción SEPARADA POR HABLANTE
// ("Titular" / "Veterinaria") y la nota SOAP propuesta dentro del panel. Ninguna de las dos se
// puede hacer honestamente hoy: `athos-live.ts` entrega dos cadenas planas —estable y provisional—
// sin roles, y la nota se genera y se aprueba en la pantalla de la consulta, con su propio flujo.
// Inventar etiquetas de hablante sería adivinar quién dijo qué en una historia clínica.

import Link from "next/link"
import { Loader2, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Cuaderno } from "@/components/athos/cuaderno"
import { consultaViva } from "@/lib/consulta-viva/sesion"
import { useConsultaViva } from "@/lib/consulta-viva/usar"

function mmss(total: number): string {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

export function PanelModoFantasma({ abierto, alCerrar }: { abierto: boolean; alCerrar: () => void }) {
  const estado = useConsultaViva()

  if (!abierto || estado.fase === "inactiva") return null

  const grabando = estado.fase === "grabando"
  const cerrando = estado.fase === "subiendo" || estado.fase === "transcribiendo"
  const fallo = estado.fase === "perdida"

  const titular = grabando
    ? "Escuchando la consulta"
    : estado.fase === "subiendo"
      ? "Guardando el audio"
      : estado.fase === "transcribiendo"
        ? "Transcribiendo"
        : fallo
          ? "La grabación se interrumpió"
          : "Listo"

  return (
    // `fixed inset-0` con el panel arriba y un velo debajo que cierra al tocarlo — la forma del
    // mockup. z-50 para quedar por encima del dock (z-40) pero al nivel de los modales: mientras
    // esto está abierto, es lo único con lo que se interactúa.
    <div className="fixed inset-0 z-50 flex flex-col">
      <div className="flex max-h-[82%] flex-col overflow-hidden border-b border-line bg-surface shadow-popover">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3.5 md:px-6">
          {grabando && (
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-brand motion-safe:animate-pulse" />
          )}
          {cerrando && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-fg-faint" />}
          {fallo && <TriangleAlert aria-hidden className="size-4 shrink-0 text-danger" />}

          <span className="text-sm font-semibold">Modo Fantasma</span>
          <span className="text-sm text-fg-muted">{titular}</span>
          {/* El cronómetro va aria-hidden: una región viva que cambia cada segundo hace que el
              lector de pantalla anuncie la hora sin parar. Mismo criterio que la pastilla. */}
          <span aria-hidden className="font-mono text-sm tabular-nums">
            {mmss(estado.segundos)}
          </span>
          {estado.pacienteNombre && (
            <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
              {estado.pacienteNombre}
            </span>
          )}

          <span className="ml-auto flex items-center gap-2">
            {grabando && (
              <Button size="sm" variant="outline" onClick={() => void consultaViva.detener()}>
                Terminar
              </Button>
            )}
            {estado.consultaId && (
              <Button
                size="sm"
                variant="ghost"
                render={<Link href={`/dashboard/consultas/${estado.consultaId}`} />}
                onClick={alCerrar}
              >
                Ir a la consulta
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={alCerrar} aria-label="Minimizar">
              <X className="size-4" />
              <span className="hidden sm:inline">Minimizar</span>
            </Button>
          </span>
        </div>

        {/* DOS COLUMNAS EN ESCRITORIO: lo que se oye a la izquierda, lo que el vet escribe a la
            derecha. Es la forma que hace del panel un cuaderno y no un visor — la transcripción
            corre sola y el cuaderno es lo único con lo que se interactúa mientras se atiende.

            En un teléfono se apilan, y el CUADERNO VA PRIMERO: ahí no hay lugar para las dos, y
            entre leer lo que se acaba de decir y poder anotar, lo segundo es lo que no se puede
            hacer en ningún otro lado. */}
        <div className="flex flex-1 flex-col-reverse gap-4 overflow-auto px-4 py-4 md:px-6 lg:grid lg:grid-cols-[1fr_minmax(0,22rem)] lg:gap-6">
          <div className="min-w-0">
            {fallo ? (
              <p className="text-sm text-danger">{estado.error ?? "La grabación falló."}</p>
            ) : estado.estable || estado.provisional ? (
              <p className="max-w-[75ch] text-sm leading-relaxed">
                {estado.estable}{" "}
                {/* Lo provisional se pinta apagado: el proveedor todavía puede reemplazarlo, y en una
                    historia clínica la diferencia entre "lo dijo" y "creo que lo dijo" importa. */}
                <span className="text-fg-muted">{estado.provisional}</span>
              </p>
            ) : (
              <p className="text-sm text-fg-muted">
                {estado.vivo
                  ? "Escuchando… el texto aparece a medida que se habla."
                  : "La transcripción en vivo no está disponible; la consulta se transcribe completa al terminar."}
              </p>
            )}
          </div>

          <Cuaderno consultaId={estado.consultaId} filas={8} className="min-w-0 lg:border-l lg:border-line lg:pl-6" />
        </div>

        {grabando && (
          <p className="border-t border-line px-4 py-3 text-[13px] text-fg-muted md:px-6">
            Grabando con el micrófono del dispositivo. La transcripción se guarda sólo si usted
            aprueba la nota.
          </p>
        )}
      </div>

      {/* El velo. Cierra al tocarlo: es la salida rápida del mockup. No detiene la grabación —
          minimizar y terminar son cosas distintas, y confundirlas acá cortaría una consulta. */}
      <button
        type="button"
        aria-label="Minimizar el Modo Fantasma"
        onClick={alCerrar}
        className="flex-1 cursor-default bg-fg/20"
      />
    </div>
  )
}
