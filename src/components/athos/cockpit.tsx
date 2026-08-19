"use client"

// El cockpit: la consulta en curso, a pantalla completa.
//
// ES EL NOTCH AMPLIADO, no otra pantalla. El vet trabaja con el notch —una pastilla arriba, sobre la
// agenda o la factura que esté mirando— y cuando quiere concentrarse en la consulta lo amplía a
// esto. `Esc` lo devuelve al notch. Las dos superficies leen el MISMO estado (ver
// `lib/consulta-viva/proveedor.tsx`): ampliar no reinicia nada ni vuelve a cobrar.
//
// POR QUÉ REEMPLAZA A LA PANTALLA DE LA CONSULTA MIENTRAS SE GRABA. Esa pantalla está armada para
// DESPUÉS: transcripción tomada, nota SOAP, aprobar. Durante la grabación no hay nada de eso
// todavía —hay una consulta pasando— y mostrar los formularios vacíos de lo que va a existir
// después es exactamente el ruido del que se quejó el cliente. Cuando la grabación termina, el
// cockpit se retira solo y la pantalla de siempre vuelve con el material ya listo.
//
// DOS PANELES Y NO TRES. El prototipo pone Live notes y Mi cuaderno lado a lado, y la transcripción
// en su propia pestaña. Es correcto: la transcripción corre sola y no se lee mientras se atiende —
// se consulta cuando hay una duda. Lo que se mira todo el tiempo es lo que Athos va armando y lo
// que uno escribe.

import { useEffect } from "react"
import { Loader2, Minimize2, Pause, Play, Sparkles, TriangleAlert } from "lucide-react"

import { AthosEnVivo } from "@/components/athos/athos-en-vivo"
import { CasosParecidos } from "@/components/athos/casos-parecidos"
import { Cuaderno } from "@/components/athos/cuaderno"
import { Button } from "@/components/ui/button"
import { consultaViva } from "@/lib/consulta-viva/sesion"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import { useVivo } from "@/lib/consulta-viva/proveedor"

const PESTANAS = [
  { id: "consulta", rotulo: "Consulta" },
  { id: "transcripcion", rotulo: "Transcripción" },
  { id: "casos", rotulo: "Casos parecidos" },
  { id: "sugerencias", rotulo: "Sugerencias" },
] as const

export type PestanaDelCockpit = (typeof PESTANAS)[number]["id"]

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

/** Un panel del cockpit: título, bajada y cuerpo con su propio scroll. */
function Panel({
  titulo,
  bajada,
  children,
}: {
  titulo: string
  bajada: string
  children: React.ReactNode
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border border-line bg-card">
      <header className="border-b border-line-soft px-4 py-3">
        <h2 className="text-[13.5px] font-semibold text-fg">{titulo}</h2>
        <p className="mt-0.5 text-[12.5px] text-fg-muted">{bajada}</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  )
}

export function Cockpit({
  pestana,
  alCambiarPestana,
  alMinimizar,
}: {
  pestana: PestanaDelCockpit
  alCambiarPestana: (p: PestanaDelCockpit) => void
  /** Vuelve al notch. NO detiene la grabación: minimizar y terminar son cosas distintas. */
  alMinimizar: () => void
}) {
  const estado = useConsultaViva()
  const vivo = useVivo()

  const pausada = estado.pausada
  const fallo = estado.fase === "perdida"

  // `Esc` MINIMIZA, que es lo que dice el propio encabezado. Sin esto la interfaz promete un atajo
  // que no existe — y es el que el prototipo enseña en pantalla.
  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key === "Escape") alMinimizar()
    }
    window.addEventListener("keydown", alTeclado)
    return () => window.removeEventListener("keydown", alTeclado)
  }, [alMinimizar])

  return (
    <div className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-fg-muted">
            {estado.pacienteNombre ?? "Consulta"} · Consulta en curso
          </p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2.5 font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-fg">
            Consulta{estado.pacienteNombre ? ` · ${estado.pacienteNombre}` : ""}
            {/* La pastilla de estado, con el mismo lenguaje que el notch: menta latiendo mientras
                entra audio, apagada y quieta en pausa. */}
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px] font-medium">
              <span
                aria-hidden
                className={`size-2 rounded-full ${
                  pausada ? "bg-fg-faint" : "bg-brand motion-safe:animate-pulse"
                }`}
              />
              {pausada ? "En pausa" : "Grabando"}
              <span aria-hidden className="font-mono tabular-nums text-fg-muted">
                {mmss(estado.segundos)}
              </span>
            </span>
          </h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            Athos escucha en modo fantasma — el titular no interactúa con él.{" "}
            <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[11px]">
              Esc
            </kbd>{" "}
            minimiza al notch.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => (pausada ? consultaViva.reanudar() : consultaViva.pausar())}
          >
            {pausada ? (
              <Play className="size-3.5" aria-hidden />
            ) : (
              <Pause className="size-3.5" aria-hidden />
            )}
            {pausada ? "Reanudar" : "Pausar"}
          </Button>
          {/* "ACABAR Y ORGANIZAR", con ese nombre. "Detener" describe lo que le pasa al micrófono;
              esto describe lo que pasa con la consulta, que es lo que el vet está decidiendo.
              No hace falta navegar: al terminar deja de haber grabación, el cockpit se retira solo
              y queda debajo la pantalla de la consulta con el material ya tomado. */}
          <Button size="sm" onClick={() => void consultaViva.detener()}>
            <Sparkles className="size-3.5" aria-hidden />
            Acabar y organizar con Athos
          </Button>
          <Button variant="ghost" size="sm" onClick={alMinimizar}>
            <Minimize2 className="size-3.5" aria-hidden />
            Minimizar
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-1 border-b border-line-soft">
        {PESTANAS.map((p) => {
          const activa = p.id === pestana
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                alCambiarPestana(p.id)
                // Mirar la alerta es lo que la apaga.
                if (p.id === "sugerencias") vivo.vistoLaAlerta()
              }}
              aria-current={activa ? "page" : undefined}
              className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                activa ? "border-brand text-fg" : "border-transparent text-fg-muted hover:text-fg"
              }`}
            >
              {p.rotulo}
              {p.id === "sugerencias" && vivo.alerta && (
                <span aria-hidden className="ml-1.5 inline-block size-1.5 rounded-full bg-warn" />
              )}
            </button>
          )
        })}
      </div>

      {pestana === "consulta" && (
        // DOS PANELES, apilados en pantalla angosta. El cuaderno va PRIMERO al apilarse: es lo
        // único con lo que se interactúa, y leer lo que Athos armó se puede hacer después.
        <div className="flex min-h-0 flex-1 flex-col-reverse gap-4 lg:flex-row">
          <Panel titulo="Live notes" bajada="Athos lo arma solo a medida que escucha">
            <AthosEnVivo vivo={vivo} soloNotas />
          </Panel>
          <Panel
            titulo="Mi cuaderno"
            bajada="Hoja en blanco — escribí libre; Athos lo organiza al acabar"
          >
            <Cuaderno consultaId={estado.consultaId} filas={14} />
          </Panel>
        </div>
      )}

      {pestana === "sugerencias" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px]">
            <AthosEnVivo vivo={vivo} soloSugerencias />
          </div>
        </div>
      )}

      {pestana === "casos" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px]">
            <CasosParecidos
              consultaId={estado.consultaId}
              transcripcion={`${estado.estable} ${estado.provisional}`.trim()}
            />
          </div>
        </div>
      )}

      {pestana === "transcripcion" && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[780px]">
            {fallo ? (
              <p className="flex items-center gap-2 text-[13px] text-danger">
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {estado.error ?? "La grabación falló."}
              </p>
            ) : estado.estable || estado.provisional ? (
              <p className="text-[13.5px] leading-relaxed">
                {estado.estable}{" "}
                {/* Lo provisional se pinta apagado: el proveedor todavía puede reemplazarlo, y en
                    una historia clínica la diferencia entre "lo dijo" y "creo que lo dijo"
                    importa. */}
                <span className="text-fg-muted">{estado.provisional}</span>
              </p>
            ) : (
              <p className="flex items-center gap-2 text-[13px] text-fg-muted">
                {estado.vivo && <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />}
                {estado.vivo
                  ? "Escuchando… el texto aparece a medida que se habla."
                  : "La transcripción en vivo no está disponible; la consulta se transcribe completa al terminar."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
