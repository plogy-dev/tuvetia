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
// después es exactamente el ruido del que se quejó el cliente.
//
// Y ACOMPAÑA EL CIERRE (`cerrando`), que es la parte que faltaba. El cockpit se quedaba sólo
// mientras la fase era `grabando`, y `detener()` cambia de fase antes de subir un solo byte: la
// pantalla saltaba al editor SOAP vacío en el mismo instante en que se soltaba el botón. Ahora se
// queda mientras se guarda y se transcribe, y se retira cuando la pantalla de siempre ya tiene el
// material — que es lo que este comentario venía prometiendo desde el principio.
//
// DOS PANELES Y NO TRES. El prototipo pone las notas en vivo y Mi cuaderno lado a lado, y la
// transcripción en su propia pestaña. Es correcto: la transcripción corre sola y no se lee mientras
// se atiende — se consulta cuando hay una duda. Lo que se mira todo el tiempo es lo que VetGPT va
// armando y lo que uno escribe.
//
// Lo que SÍ se agregó abajo es una TIRA de tres renglones (`TiraEnVivo`), y no contradice lo de
// arriba: no es un panel para leer, es la prueba de que el micrófono está tomando algo. Sin ella,
// la pestaña por defecto no mostraba una sola palabra durante los primeros 20-30 segundos y el
// cliente concluyó, con razón, que «no hay transcripción en vivo».

import { useEffect, useRef } from "react"
import { Loader2, Minimize2, Pause, Play, Sparkles, TriangleAlert } from "lucide-react"

import { comoReloj } from "@/lib/duracion"
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

/**
 * La tira de transcripción en vivo: lo que se está oyendo, ahí, sin tener que ir a buscarlo.
 *
 * ── POR QUÉ EXISTE ──────────────────────────────────────────────────────────────────────────────
 *
 * David, 26-ago, probando el Modo Fantasma: «no hay transcripción en vivo». La había —está la
 * pestaña «Transcripción», tres clics más allá— pero la pestaña que se abre por defecto es
 * «Consulta», y ahí no se veía una sola palabra. Peor: «Notas en vivo» no muestra nada durante los
 * primeros 20-30 segundos, porque su disparador espera 15 s Y 40 palabras nuevas estables. O sea
 * que en el momento en que el vet mira la pantalla para confirmar que lo está escuchando, la
 * pantalla no le contesta.
 *
 * NO ES UN TERCER PANEL, y esa distinción sostiene la decisión de «dos paneles y no tres» de
 * arriba: es una banda de estado de tres renglones. No se lee mientras se atiende —para eso está
 * la pestaña, con el texto entero— pero se ve de reojo, y de reojo alcanza para saber que la
 * consulta se está tomando. Es la diferencia entre confiar en el Modo Fantasma y no confiar.
 *
 * Y CUANDO EL VIVO NO ESTÁ, LO DICE. Antes fallaba en silencio: `sesion.ts` hace un `console.info`
 * y nada más, así que una `DEEPGRAM_API_KEY` ausente en el servidor se veía exactamente igual que
 * una consulta callada. Acá se distingue, y se aclara que el audio igual se transcribe entero al
 * acabar — que es cierto y es lo que evita que el vet corte la grabación creyendo que se perdió.
 */
function TiraEnVivo({
  estable,
  provisional,
  vivo,
  cerrando,
}: {
  estable: string
  provisional: string
  vivo: boolean
  cerrando: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)

  // Pegada al final, como una consola: lo último que se dijo es lo único que interesa de un
  // vistazo. Sin esto la tira se queda mostrando el saludo del principio toda la consulta.
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [estable, provisional])

  const hayTexto = Boolean(estable || provisional)

  return (
    <section
      className="shrink-0 rounded-xl border border-line bg-surface-2 px-4 py-2.5"
      aria-label="Transcripción en vivo"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${
            vivo && !cerrando ? "bg-brand motion-safe:animate-pulse" : "bg-fg-faint"
          }`}
        />
        <h2 className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-fg-muted">
          {cerrando ? "Transcripción" : "Se está oyendo"}
        </h2>
      </div>

      <div
        ref={ref}
        // Tres renglones y su propio scroll. Un alto fijo es deliberado: si creciera con el texto,
        // en una consulta de veinte minutos se comería los dos paneles.
        className="mt-1.5 h-[3.9rem] overflow-y-auto text-[13px] leading-[1.32] text-fg"
        aria-live="polite"
      >
        {hayTexto ? (
          <p>
            {estable}{" "}
            {/* Lo provisional va apagado: el proveedor todavía puede reemplazarlo, y en una
                historia clínica «lo dijo» y «creo que lo dijo» no son lo mismo. */}
            <span className="text-fg-muted">{provisional}</span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-fg-muted">
            {vivo && !cerrando && (
              <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
            )}
            {!vivo
              ? "La transcripción en vivo no está disponible en este momento — la consulta se transcribe completa al acabar, y la nota sale igual."
              : cerrando
                ? "Sin texto en vivo. La consulta se está transcribiendo completa."
                : "Escuchando… las palabras aparecen a medida que se habla."}
          </p>
        )}
      </div>
    </section>
  )
}

export function Cockpit({
  pestana,
  alCambiarPestana,
  alMinimizar,
  cerrando = false,
}: {
  pestana: PestanaDelCockpit
  alCambiarPestana: (p: PestanaDelCockpit) => void
  /** Vuelve al notch. NO detiene la grabación: minimizar y terminar son cosas distintas. */
  alMinimizar: () => void
  /**
   * El micrófono ya se cerró y la consulta se está guardando/transcribiendo. El cockpit SE QUEDA
   * —ver `page.tsx`— para que la pantalla no cambie de golpe apenas se suelta el botón.
   */
  cerrando?: boolean
}) {
  const estado = useConsultaViva()
  const vivo = useVivo()

  const pausada = estado.pausada
  const fallo = estado.fase === "perdida"
  const subiendo = estado.fase === "subiendo"

  // `Esc` MINIMIZA, que es lo que dice el propio encabezado. Sin esto la interfaz promete un atajo
  // que no existe — y es el que el prototipo enseña en pantalla.
  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if (e.key === "Escape") alMinimizar()
    }
    window.addEventListener("keydown", alTeclado)
    return () => window.removeEventListener("keydown", alTeclado)
  }, [alMinimizar])

  // EL ALTO SE HEREDA, NO SE CALCULA — mismo defecto que tenía el chat: `100svh - header` ignora
  // el `m-2` que `variant="inset"` le pone al `SidebarInset`, y esos 16 px de más hacen que el
  // navegador pinte la barra de la ventana entera. `flex-1 min-h-0` toma lo que quede, sin números.
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12.5px] text-fg-muted">
            {estado.pacienteNombre ?? "Consulta"} · Consulta en curso
          </p>
          <h1 className="mt-0.5 flex flex-wrap items-center gap-2.5 font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.015em] text-fg">
            Consulta{estado.pacienteNombre ? ` · ${estado.pacienteNombre}` : ""}
            {/* La pastilla de estado, con el mismo lenguaje que el notch: menta latiendo mientras
                entra audio, apagada y quieta en pausa, y girando mientras se cierra. */}
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[12.5px] font-medium">
              {cerrando ? (
                <Loader2 className="size-3 shrink-0 animate-spin text-fg-muted" aria-hidden />
              ) : (
                <span
                  aria-hidden
                  className={`size-2 rounded-full ${
                    pausada ? "bg-fg-faint" : "bg-brand motion-safe:animate-pulse"
                  }`}
                />
              )}
              {cerrando
                ? subiendo
                  ? "Guardando el audio"
                  : "Transcribiendo"
                : pausada
                  ? "En pausa"
                  : "Grabando"}
              {/* El cronómetro se queda mientras se cierra: dice cuánto duró la consulta, y ver el
                  número congelado es parte de entender que la grabación ya terminó bien. */}
              <span aria-hidden className="font-mono tabular-nums text-fg-muted">
                {comoReloj(estado.segundos)}
              </span>
            </span>
          </h1>
          <p className="mt-1 text-[13px] text-fg-muted">
            {cerrando ? (
              <>
                El micrófono ya se cerró. VetGPT está organizando la consulta — puede tardar un
                momento. Podés esperar acá o seguir trabajando: la nota te espera cuando esté.
              </>
            ) : (
              <>
                VetGPT escucha en modo fantasma — el titular no interactúa con él.{" "}
                <kbd className="rounded border border-line bg-surface-2 px-1 font-mono text-[11px]">
                  Esc
                </kbd>{" "}
                minimiza al notch.
              </>
            )}
          </p>
        </div>

        {/* MIENTRAS SE CIERRA NO SE OFRECE PAUSAR NI ACABAR: no hay micrófono que pausar y ya se
            acabó. Dejarlos habilitados invita a apretar dos veces algo que no se puede deshacer y
            a leer un error del cerrojo de sesión única. Queda «Minimizar», que sigue siendo cierto
            —el notch acompaña— y que es justo la salida que el vet necesita si no quiere esperar. */}
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {!cerrando && (
            <>
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
              {/* "ACABAR Y ORGANIZAR", con ese nombre. "Detener" describe lo que le pasa al
                  micrófono; esto describe lo que pasa con la consulta, que es lo que el vet está
                  decidiendo. No hace falta navegar: el cockpit acompaña el cierre y se retira solo
                  cuando la pantalla de la consulta ya tiene el material tomado. */}
              <Button size="sm" onClick={() => void consultaViva.detener()}>
                <Sparkles className="size-3.5" aria-hidden />
                Acabar y organizar con VetGPT
              </Button>
            </>
          )}
          <Button variant="ghost" size="sm" onClick={alMinimizar}>
            <Minimize2 className="size-3.5" aria-hidden />
            {cerrando ? "Seguir trabajando" : "Minimizar"}
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
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {/* DOS PANELES, apilados en pantalla angosta. El cuaderno va PRIMERO al apilarse: es lo
              único con lo que se interactúa, y leer lo que VetGPT armó se puede hacer después. */}
          <div className="flex min-h-0 flex-1 flex-col-reverse gap-4 lg:flex-row">
            <Panel titulo="Notas en vivo" bajada="VetGPT lo arma solo a medida que escucha">
              <AthosEnVivo vivo={vivo} soloNotas />
            </Panel>
            <Panel
              titulo="Mi cuaderno"
              bajada="Hoja en blanco — escribí libre; VetGPT lo organiza al acabar"
            >
              <Cuaderno consultaId={estado.consultaId} filas={14} />
            </Panel>
          </div>
          {/* Debajo de los dos y no entre ellos: se ve sin mirarla, que es todo lo que tiene que
              hacer. El texto completo sigue viviendo en su pestaña. */}
          <TiraEnVivo
            estable={estado.estable}
            provisional={estado.provisional}
            vivo={estado.vivo}
            cerrando={cerrando}
          />
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
                {estado.vivo && !cerrando && (
                  <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />
                )}
                {!estado.vivo
                  ? "La transcripción en vivo no está disponible; la consulta se transcribe completa al terminar."
                  : cerrando
                    ? "Sin texto en vivo. La consulta se está transcribiendo completa."
                    : "Escuchando… el texto aparece a medida que se habla."}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
