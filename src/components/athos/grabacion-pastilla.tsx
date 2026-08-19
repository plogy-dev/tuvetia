"use client"

// El notch: "Athos · Canela · 12:43", arriba y al centro, visible en TODA la app.
//
// LA FORMA VIENE DEL PROTOTIPO DEL CLIENTE, que es lo que se acordó el 17-ago. Cuatro cosas cambian
// respecto de lo que teníamos, y ninguna es cosmética:
//
//   1. **Arriba y al centro, no abajo a la derecha.** Abajo competía con el widget de Athos y con la
//      barra de pestañas del móvil, y quedaba en la esquina donde uno no mira. Arriba al centro es
//      donde el sistema pone lo que está en curso, y es donde el vet ya lo busca.
//
//   2. **Oscura en los dos temas.** No es un descuido: la pastilla no es contenido de la app, es
//      cromo por encima de ella — como la barra de grabación del teléfono. Pintarla con los tokens
//      de superficie la volvía una tarjeta más flotando sobre la pantalla.
//
//   3. **Las barras del ecualizador.** Es lo que distingue "el micrófono está tomado" de "te estoy
//      escuchando": un punto encendido no dice si algo está entrando. **Se detienen en pausa**, y
//      ahí comunican el estado sin una palabra.
//
//   4. **Pausar y detener viven acá.** Antes pausar sólo estaba dentro del panel, o sea que
//      interrumpir la consulta obligaba a abrir una superficie entera. Es la acción más urgente de
//      la consulta y estaba a dos clics.
//
// NO ES DECORACIÓN, ES EL CONTRAPESO. Desde que la grabación sobrevive la navegación, el vet puede
// tener el micrófono abierto mientras mira la agenda, una factura o la ficha de otro paciente. Sin
// un indicador permanente eso es un micrófono abierto que nadie ve.
//
// Y la etiqueta NOMBRA AL PACIENTE a propósito: es la prueba visible, para el vet y para quien mire
// la pantalla, de que el alcance es UNA consulta y no la jornada entera.

import Link from "next/link"
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  Pause,
  Play,
  Square,
  Stethoscope,
  TriangleAlert,
} from "lucide-react"

import { consultaViva } from "@/lib/consulta-viva/sesion"
import { useConsultaViva } from "@/lib/consulta-viva/usar"

function mmss(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
}

// LA PASTILLA ES OSCURA EN LOS DOS TEMAS, y se consigue con la clase `.consulta` que el sistema ya
// tiene: declara la paleta oscura completa —en nuestro menta, no en el azul del prototipo— sobre
// cualquier subárbol. Así esto no lleva ni un color crudo y sigue el tema del producto.
//
// Sin ella, `text-warn` en modo claro resolvía a `#8a5a0b` sobre un fondo casi negro: 2,8:1, o sea
// la etiqueta "Pausada" ilegible justo cuando más hay que verla. Con `.consulta` es `#e5c078`.

/** Un botón del notch: icono de 13,5px, radio 7px, sin fondo hasta el hover. */
function Accion({
  onClick,
  etiqueta,
  children,
}: {
  onClick: () => void
  etiqueta: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={etiqueta}
      title={etiqueta}
      className="grid shrink-0 place-items-center rounded-[7px] p-[5px] text-fg-muted transition-colors hover:bg-fg/10 hover:text-fg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  )
}

export function GrabacionPastilla({
  abierto,
  alerta,
  alAlternar,
}: {
  /** ¿El panel está desplegado? Cambia el galón y deja de redondear el borde de abajo. */
  abierto?: boolean
  /**
   * Hay una sugerencia urgente sin mirar.
   *
   * ES EL MECANISMO DEL PROTOTIPO —"las urgentes prenden la luz del notch"— y resuelve bien un
   * problema real: algo que no puede esperar tiene que avisar, pero abrir el panel solo encima de
   * lo que el vet está haciendo con un animal delante es peor que el problema. Un aro ámbar avisa
   * sin interrumpir, y se apaga cuando el vet abre la pestaña.
   */
  alerta?: boolean
  alAlternar?: () => void
}) {
  const estado = useConsultaViva()

  if (estado.fase === "inactiva" || estado.fase === "terminada") return null

  const enCurso = estado.fase === "grabando"
  const cerrando = estado.fase === "subiendo" || estado.fase === "transcribiendo"
  const fallo = estado.fase === "perdida"
  const pausada = enCurso && estado.pausada

  // Una barra del ecualizador. `motion-safe:` porque cuatro barras latiendo son exactamente el tipo
  // de movimiento que hay que poder apagar; sin la animación la barra queda a su altura y el grupo
  // se sigue leyendo como un ecualizador.
  const barra = (alto: string, retraso: string) =>
    `w-[2.5px] origin-bottom rounded-[2px] bg-brand ${alto} motion-safe:animate-[eq_1s_ease-in-out_infinite] ${retraso} ${
      pausada ? "[animation-play-state:paused]" : ""
    }`

  return (
    <div
      role="status"
      // El nombre accesible es ESTÁTICO. El cronómetro va aria-hidden porque una región viva que
      // cambia cada segundo hace que el lector de pantalla anuncie la hora sin parar, y eso vuelve
      // la app inusable para quien lo necesita.
      aria-label={
        enCurso
          ? `${pausada ? "Consulta en pausa" : "Grabando la consulta"}${
              estado.pacienteNombre ? ` de ${estado.pacienteNombre}` : ""
            }`
          : cerrando
            ? "Guardando la grabación"
            : "La grabación falló"
      }
      className={`consulta pointer-events-auto flex h-[42px] max-w-[calc(100vw-24px)] items-center gap-2 border border-line bg-ink pl-[13px] pr-2 text-fg shadow-popover ${
        abierto ? "rounded-t-[18px]" : "rounded-full"
      } ${alerta ? "ring-[3px] ring-warn/40" : ""}`}
    >
      {/* El punto de estado. MENTA Y NO ROJO: el prototipo usa su brasa, pero acá el rojo está
          reservado para lo que salió mal —esta misma pastilla lo usa para el fallo— y el menta es el
          color de "activo" del sistema. Late mientras entra audio; apagado y quieto en pausa. */}
      {enCurso && (
        <span
          aria-hidden
          className={`inline-flex size-2 shrink-0 rounded-full ${
            alerta
              ? "bg-warn motion-safe:animate-pulse"
              : pausada
                ? "bg-fg-faint"
                : "bg-brand motion-safe:animate-pulse"
          }`}
        />
      )}
      {cerrando && (
        <Loader2 aria-hidden className="size-3.5 shrink-0 animate-spin text-fg-faint" />
      )}
      {fallo && <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-danger" />}

      {enCurso && (
        <span
          aria-hidden
          className={`hidden h-[13px] shrink-0 items-end gap-[2.5px] sm:flex ${pausada ? "opacity-30" : ""}`}
        >
          <i className={barra("h-[6px]", "")} />
          <i className={barra("h-[12px]", "[animation-delay:.15s]")} />
          <i className={barra("h-[8px]", "[animation-delay:.3s]")} />
          <i className={barra("h-[11px]", "[animation-delay:.45s]")} />
        </span>
      )}

      <Stethoscope
        className="hidden size-[13.5px] shrink-0 text-fg-faint sm:block"
        aria-hidden
      />
      <span className="shrink-0 text-[13px] font-semibold tracking-[0.01em]">Athos</span>

      {estado.pacienteNombre && (
        <>
          <span aria-hidden className="shrink-0 text-fg-faint/70">
            ·
          </span>
          <span className="min-w-0 truncate text-[13px] font-medium" title={estado.pacienteNombre}>
            {estado.pacienteNombre}
          </span>
        </>
      )}

      {enCurso && (
        <>
          <span aria-hidden className="hidden shrink-0 text-fg-faint/70 sm:inline">
            ·
          </span>
          <span
            aria-hidden
            className="hidden shrink-0 font-mono text-[11.5px] tabular-nums text-fg-muted sm:inline"
          >
            {mmss(estado.segundos)}
          </span>
        </>
      )}

      {pausada && (
        <span className="ml-1 shrink-0 text-[9px] font-semibold uppercase tracking-[0.13em] text-warn">
          Pausada
        </span>
      )}

      {cerrando && (
        <span className="shrink-0 text-[11.5px] text-fg-muted">Guardando…</span>
      )}
      {fallo && (
        <span className="min-w-0 truncate text-[11.5px] text-danger">
          {estado.error ?? "Falló la grabación"}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-px pl-1">
        {/* PAUSAR VIVE ACÁ, no dentro del panel. Es la acción más urgente de la consulta —el titular
            sale a buscar el carnet, entra alguien, suena el teléfono— y estaba a dos clics. */}
        {enCurso && (
          <Accion
            onClick={() => (pausada ? consultaViva.reanudar() : consultaViva.pausar())}
            etiqueta={pausada ? "Reanudar" : "Pausar"}
          >
            {pausada ? <Play className="size-[13.5px]" /> : <Pause className="size-[13.5px]" />}
          </Accion>
        )}

        {/* Detener sólo en escritorio. En móvil el botón queda al alcance del pulgar y un toque
            accidental corta una consulta clínica: ahí se termina desde el panel. */}
        {enCurso && (
          <span className="hidden sm:contents">
            <Accion onClick={() => void consultaViva.detener()} etiqueta="Terminar la consulta">
              <Square className="size-[13.5px]" />
            </Accion>
          </span>
        )}

        {fallo && (
          <Accion onClick={() => consultaViva.reiniciar()} etiqueta="Entendido">
            <Square className="size-[13.5px]" />
          </Accion>
        )}

        {alAlternar ? (
          <Accion onClick={alAlternar} etiqueta={abierto ? "Contraer" : "Abrir la consulta"}>
            {abierto ? <ChevronUp className="size-[13.5px]" /> : <ChevronDown className="size-[13.5px]" />}
          </Accion>
        ) : (
          // Sin panel donde desplegarse —montada suelta en un test o una pantalla— cae al enlace de
          // antes en vez de quedarse sin salida.
          estado.consultaId && (
            <Link
              href={`/dashboard/consultas/${estado.consultaId}`}
              aria-label="Ir a la consulta"
              title="Ir a la consulta"
              className="grid shrink-0 place-items-center rounded-[7px] p-[5px] text-fg-muted transition-colors hover:bg-fg/10 hover:text-fg"
            >
              <ChevronDown className="size-[13.5px]" />
            </Link>
          )
        )}
      </div>
    </div>
  )
}
