"use client"

import { Check, Lock } from "lucide-react"

// La barra de autonomía de VetGPT — cuánta libertad tiene para actuar solo.
//
// ── DE DÓNDE SALE (reunión del 28-ago, Luciano, 24:07) ──────────────────────────────────────
//
// «Sería chévere ponerle como una barrita en la que el usuario pudiera ir graduando el nivel de
// autonomía en el que [el agente] puede actuar y tomar decisiones. Ese nivel de pronto se pueda
// ir GANANDO — que empiece en nada y con el uso se vaya volviendo más y más.»
//
// ── QUÉ ES HOY, Y QUÉ NO TODAVÍA ────────────────────────────────────────────────────────────
//
// Tres niveles a la vista, DOS operables. Los dos primeros son los únicos valores que la API
// acepta (`api/whatsapp/agent-mode` valida `z.enum(["review","auto"])`) y los únicos con
// comportamiento real detrás. El tercero está BLOQUEADO a propósito: es la promesa de la
// progresión — mostrar a dónde va la barra sin fingir que ya llega.
//
// LA PARTE DE «SE GANA CON EL USO» YA EXISTE A MEDIAS, y esta barra la cuenta por primera vez:
// `auto-reply.ts` tiene una rampa de calentamiento — 5 respuestas/día el día que se conecta el
// número, +5 por cada día conectado, hasta el límite configurado. Existía muda; acá se muestra
// («hoy puede enviar hasta N respuestas»), que es la mitad narrativa de lo que pidió Luciano.
//
// ── DISEÑO DE LA V2 (escrito para quien la implemente, no para hoy) ─────────────────────────
//
// Desbloquear el nivel 3 cuando la clínica acumule X respuestas automáticas sin intervención
// del vet. El dato ya se registra: `athos_actions` con `source='auto'` y `status='executed'`
// es cada respuesta que salió sola, y una intervención es el vet retomando el hilo. El contador
// es una consulta; la regla de graduación (¿50? ¿200?) es la decisión de producto que falta.
// Cuando exista, el nivel 3 habilita `propose_appointment` con confirmación automática — hoy
// toda cita propuesta queda pendiente de que el equipo la confirme.

type Modo = "auto" | "review" | "paused" | "intervene"

type Nivel = {
  valor: Modo | null // null = todavía no operable
  titulo: string
  detalle: string
}

const NIVELES: Nivel[] = [
  {
    valor: "review",
    titulo: "Sólo sugerir",
    // «así arranca»: el test de las decisiones del 26-ago fija esta frase — quien ve el nivel
    // tiene que saber que es el estado de fábrica.
    detalle:
      "Así arranca: VetGPT no le escribe solo a nadie. Sugiere la respuesta en la bandeja y sale únicamente cuando vos la apruebes.",
  },
  {
    valor: "auto",
    titulo: "Responde lo básico",
    detalle:
      "VetGPT le responde a todo el que escriba — horarios, ubicación y pedidos de cita. Lo clínico nunca: eso queda en la bandeja para vos.",
  },
  {
    valor: null,
    titulo: "Agenda y confirma",
    detalle:
      "Confirmará citas sin pasar por la bandeja. Se desbloquea con el uso: primero hay que ver al asistente responder bien un tiempo.",
  },
]

export function BarraDeAutonomia({
  modo,
  ocupado,
  onCambiar,
  cupoAutoDeHoy,
}: {
  modo: Modo
  ocupado: boolean
  onCambiar: (siguiente: "auto" | "review") => void
  /** Respuestas auto que puede enviar hoy — lo cuenta el servidor con `lib/whatsapp/rampa`. */
  cupoAutoDeHoy: number | null
}) {
  // El índice del nivel activo. `paused`/`intervene` (sin UI hoy) se pintan como nivel 1.
  const activo = modo === "auto" ? 1 : 0

  return (
    <div className="rounded-xl border px-4 py-3">
      <p className="text-sm font-semibold">Autonomía de VetGPT</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Cuánto puede hacer sin pasar por vos. Se sube de a un nivel — y el tercero se gana.
      </p>

      {/* La barrita: el riel con los tres puntos, y el relleno hasta el nivel activo. */}
      <div role="radiogroup" aria-label="Nivel de autonomía de VetGPT" className="mt-4">
        <div className="relative mx-2 h-1 rounded-full bg-fg-faint/25">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-ok transition-all"
            style={{ width: `${(activo / (NIVELES.length - 1)) * 100}%` }}
          />
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between">
            {NIVELES.map((nivel, i) => {
              const esActivo = i === activo
              const bloqueado = nivel.valor === null
              return (
                <button
                  key={nivel.titulo}
                  type="button"
                  role="radio"
                  aria-checked={esActivo}
                  aria-label={`${nivel.titulo}${bloqueado ? " (bloqueado: se desbloquea con el uso)" : ""}`}
                  disabled={ocupado || bloqueado}
                  onClick={() => {
                    if (!bloqueado && !esActivo) onCambiar(nivel.valor as "auto" | "review")
                  }}
                  className={`grid size-6 place-items-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    esActivo
                      ? "border-ok bg-ok text-white"
                      : bloqueado
                        ? "cursor-not-allowed border-line bg-surface text-fg-faint"
                        : "border-line bg-surface text-transparent hover:border-ok"
                  }`}
                >
                  {bloqueado ? (
                    <Lock className="size-3" aria-hidden />
                  ) : (
                    <Check className="size-3.5" aria-hidden />
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {/* Los rótulos, alineados con sus puntos. */}
        <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
          {NIVELES.map((nivel, i) => (
            <span
              key={nivel.titulo}
              className={`text-[11.5px] leading-tight font-medium ${
                i === activo ? "text-fg" : "text-fg-muted"
              } ${i === 0 ? "text-left" : i === NIVELES.length - 1 ? "text-right" : ""}`}
            >
              {nivel.titulo}
            </span>
          ))}
        </div>
      </div>

      {/* El detalle del nivel activo — y la rampa, que es la parte «se gana con el uso». */}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{NIVELES[activo].detalle}</p>
      {activo === 1 && cupoAutoDeHoy !== null && (
        <p className="mt-1.5 text-xs text-fg-faint">
          Hoy puede enviar hasta <span className="font-medium text-fg-muted">{cupoAutoDeHoy}</span>{" "}
          respuestas — el cupo sube solo con los días de uso.
        </p>
      )}
    </div>
  )
}
