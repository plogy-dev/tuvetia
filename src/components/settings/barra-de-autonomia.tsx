"use client"

import { Check, CircleAlert } from "lucide-react"

import type { Requisito } from "@/lib/whatsapp/requisitos-del-modo-automatico"
import { nivelDeLasColumnas, type NivelDeAutonomia } from "@/lib/whatsapp/nivel-de-autonomia"

// La barra de autonomía de VetGPT — cuánta libertad tiene para actuar solo.
//
// ── DE DÓNDE SALE (reunión del 28-ago, Luciano, 24:07) ──────────────────────────────────────
//
// «Sería chévere ponerle como una barrita en la que el usuario pudiera ir graduando el nivel de
// autonomía en el que [el agente] puede actuar y tomar decisiones. Ese nivel de pronto se pueda
// ir GANANDO — que empiece en nada y con el uso se vaya volviendo más y más.»
//
// ── LOS TRES NIVELES, Y CÓMO SE GUARDAN ─────────────────────────────────────────────────────
//
// Los tres son operables desde el 31-ago. El estado NO es un enum de tres valores: sale de dos
// columnas de `whatsapp_integrations` y se deriva acá.
//
//     review    → agent_mode='review'
//     auto      → agent_mode='auto', confirma_citas_solo=false
//     confirma  → agent_mode='auto', confirma_citas_solo=true
//
// Y esa forma no es capricho: TODO el sistema pregunta `agent_mode = 'auto'` para saber si puede
// hablar (`auto-reply.ts`, `cartera/wa-router.ts`). Un tercer valor del enum dejaría a la clínica de
// nivel 3 con el agente entero mudo — el porqué completo está en la migración 0102.
//
// ── POR QUÉ EL TERCERO YA NO ESTÁ BLOQUEADO ─────────────────────────────────────────────────
//
// Nació con candado, como promesa de la progresión, esperando una regla de «se gana con el uso»
// (¿50 respuestas? ¿200?) que quedó anotada como «la decisión de producto que falta». Nunca se
// tomó, y mientras tanto ninguna clínica podía dejar que VetGPT cerrara una cita — que era
// exactamente lo que hacía falta para probar con veterinarios reales. Se abrió; lo enciende el
// administrador.
//
// LA PROGRESIÓN DE LUCIANO NO SE PIERDE, y es la parte que ya existía muda: `auto-reply.ts` tiene
// una rampa de calentamiento —5 respuestas/día el día que se conecta el número, +5 por cada día
// conectado, hasta el límite configurado— que esta barra cuenta («hoy puede enviar hasta N»). Ése
// es el límite que de verdad sube solo con el uso.
//
// Si algún día se quiere el candado de vuelta, el dato para calcularlo está: `athos_actions` con
// `source='auto'` y `status='executed'` es cada respuesta que salió sola.

type Modo = "auto" | "review" | "paused" | "intervene"

/** `valor` es lo que se le manda al endpoint, no lo que la base guarda. Ver la cabecera. */
type Nivel = {
  valor: NivelDeAutonomia
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
    valor: "confirma",
    titulo: "Agenda y confirma",
    // Dice lo que el vet DEJA DE HACER y lo que sigue sin poder hacer. Es el único nivel donde algo
    // se crea sin que nadie mire, así que la frase tiene que dejarlo claro antes del clic.
    detalle:
      "VetGPT cierra la cita solo: crea el titular, la mascota y la cita, y le manda la confirmación al titular. Vos la ves en la agenda, ya hecha. Lo clínico sigue sin tocarlo.",
  },
]

export function BarraDeAutonomia({
  modo,
  ocupado,
  confirmaSolo = false,
  onCambiar,
  cupoAutoDeHoy,
  requisitos = [],
}: {
  modo: Modo
  /** Nivel 3 encendido (`whatsapp_integrations.confirma_citas_solo`). Sólo cuenta con `modo=auto`. */
  confirmaSolo?: boolean
  ocupado: boolean
  onCambiar: (siguiente: NivelDeAutonomia) => void
  /** Respuestas auto que puede enviar hoy — lo cuenta el servidor con `lib/whatsapp/rampa`. */
  cupoAutoDeHoy: number | null
  /**
   * Lo que le falta a la clínica para que esto funcione de verdad, de
   * `lib/whatsapp/requisitos-del-modo-automatico`.
   *
   * Ese módulo existía desde el 27-ago —completo y probado— y NO LO CONSUMÍA NADIE. El resultado se
   * midió el 30-ago: una clínica encendió el modo automático con cero horarios cargados, la pantalla
   * dijo «Encendidas», y el problema apareció recién del lado del cliente, cuando un titular pidió
   * cita y VetGPT no tenía ni un cupo que ofrecerle.
   *
   * Por defecto vacío: quien no lo pase no ve nada, igual que antes.
   */
  requisitos?: Requisito[]
}) {
  // SÓLO LO QUE FALTA. La lista completa —incluidos los cumplidos— es útil cuando algo no anda y se
  // está diagnosticando; acá, al lado del interruptor, tres renglones verdes son ruido que hace que
  // no se lea el cuarto, que es el que importa.
  const pendientes = requisitos.filter((r) => !r.cumplido)
  // El punto activo sale de la MISMA función que el endpoint usa al revés para guardar. Con dos
  // traducciones separadas, la barra terminaría pintando un nivel distinto del que está guardado.
  const activo = NIVELES.findIndex((n) => n.valor === nivelDeLasColumnas(modo, confirmaSolo))

  return (
    <div className="rounded-xl border px-4 py-3">
      <p className="text-sm font-semibold">Autonomía de VetGPT</p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Cuánto puede hacer sin pasar por vos. Se sube y se baja de a un nivel, cuando quieras.
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
              return (
                <button
                  key={nivel.titulo}
                  type="button"
                  role="radio"
                  aria-checked={esActivo}
                  aria-label={nivel.titulo}
                  disabled={ocupado}
                  onClick={() => {
                    if (!esActivo) onCambiar(nivel.valor)
                  }}
                  className={`grid size-6 place-items-center rounded-full border-2 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    esActivo
                      ? "border-ok bg-ok text-white"
                      : "border-line bg-surface text-transparent hover:border-ok"
                  }`}
                >
                  <Check className="size-3.5" aria-hidden />
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

      {/* LO QUE FALTA, AL LADO DEL INTERRUPTOR Y NO EN OTRA PANTALLA. El aviso de los horarios ya
          existía, pero vivía en la pantalla de HORARIOS contando que VetGPT los usa: o sea que sólo
          lo leía quien ya estaba cargándolos. Quien enciende el modo automático no pasa por ahí. */}
      {pendientes.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1.5 border-t pt-3">
          {pendientes.map((r) => (
            <li key={r.id} className="flex items-start gap-2 text-xs leading-relaxed">
              <CircleAlert
                className={`mt-px size-3.5 shrink-0 ${r.bloqueante ? "text-warn" : "text-fg-faint"}`}
                aria-hidden
              />
              <span className={r.bloqueante ? "text-fg-muted" : "text-muted-foreground"}>{r.texto}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
