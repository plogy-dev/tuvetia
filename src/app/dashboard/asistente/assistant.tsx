"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  getStaticToolName,
  isStaticToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import { Loader2, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { renderInline, splitBlocks } from "@/components/athos/rich-text"
import { ActionApprovalCard } from "@/components/athos/action-approval-card"
import { ConnectEmailCard } from "@/components/athos/connect-email-card"
import { PendingActions } from "@/components/athos/pending-actions"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { SelectorDeContexto } from "@/components/athos/selector-de-contexto"
import { pacienteDetectado } from "@/lib/athos-context/detectado"

import type { StoredThreads } from "@/lib/athos-history"
import { CONEXION_CORREO } from "@/lib/athos-agent/conversacion"
import { useCapacidad } from "@/components/planes/plan-provider"
import { useModalPro } from "@/components/planes/modal-subir-a-pro"

// `owner` es el nombre del titular, y no es decoración: es lo que distingue a dos mascotas que se
// llaman igual en el buscador de contexto. Es la objeción que Jesús puso en la reunión del 17-ago
// —"si tú tienes 7 perros que tienen leucemia… la característica específica se te llega a escapar"—
// resuelta donde se elige el paciente.
export type AssistantPatient = { id: string; name: string; species: string; owner?: string | null }

const GENERAL = "__general__" // valor del selector para "Consulta general (sin paciente)"

// Transport único hacia el agente Athos (/api/athos/agent, Vercel AI SDK). El patientId NO va
// aquí: cambia con el selector, así que viaja en el body de cada sendMessage.
const transport = new DefaultChatTransport({ api: "/api/athos/agent" })

// Etiquetas en español de las tools de LECTURA. Se usan MIENTRAS la tool corre ("Consultando X…")
// y para nombrar el fallo si algo sale mal — no para dejar constancia cuando sale bien.
// Las tools que no están aquí son de escritura: proponen acciones que el vet aprueba.
const READ_TOOL_LABELS: Record<string, string> = {
  search_patients: "pacientes de la clínica",
  get_patient_summary: "la ficha del paciente",
  get_owner_by_phone: "el titular por teléfono",
  list_appointments_on_day: "la agenda del día",
  get_clinic_hours: "los horarios de la clínica",
  list_available_slots: "los cupos disponibles",
  search_whatsapp_conversation: "la conversación de WhatsApp",
  search_emails: "tu correo",
  read_email_thread: "el hilo de correo",
  search_clinical_evidence: "la literatura veterinaria",
}

/**
 * ¿La tool falló porque falta conectar una cuenta?
 *
 * Es un fallo con SOLUCIÓN, no un error a informar: se rinde como tarjeta con el botón de conectar
 * en vez de una línea gris que el vet no puede accionar.
 */
function necesitaConexion(output: unknown): boolean {
  if (!output || typeof output !== "object") return false
  return (output as { needs_connection?: unknown }).needs_connection === CONEXION_CORREO
}

// Salida de una tool de ESCRITURA: la acción quedó registrada como PROPUESTA (ver
// lib/athos-agent/actions.ts) y se rinde como tarjeta de aprobación.
type ProposedOutput = { action_id: string; summary: string }

function asProposed(output: unknown): ProposedOutput | null {
  if (!output || typeof output !== "object") return null
  const o = output as Record<string, unknown>
  return typeof o.action_id === "string" && o.status === "proposed" && typeof o.summary === "string"
    ? { action_id: o.action_id, summary: o.summary }
    : null
}

function outputError(output: unknown): string | null {
  if (!output || typeof output !== "object") return null
  const e = (output as { error?: unknown }).error
  return typeof e === "string" ? e : null
}

// Bloques de texto del asistente con el formato de siempre (rich-text compartido). El agente cita
// las fuentes en el propio texto, así que renderInline va sin lista de citas.
/**
 * Quita las marcas `[[propuesto:…]]` que se persisten con el turno.
 *
 * Son contexto PARA EL MODELO —le muestran que ese turno sí llamó una herramienta, y no solo lo
 * dijo— pero no son contenido para el veterinario. Ver `turnoAGuardar` en conversacion.ts.
 */
function sinMarcas(texto: string): string {
  return texto
    // `[^\]]*` y no `[a-z_,]+`: el patrón estricto sólo tapaba las marcas que escribe el servidor,
    // y las que escribe el MODELO no respetan ese formato. En producción quedó a la vista del vet
    // `[[propuesto:send_email, send_email]]` — el espacio rompía el patrón y la marca se pintó como
    // texto. `turnoAGuardar` ya no las persiste, pero las filas viejas siguen guardadas.
    .replace(/\s*\[\[propuesto:[^\]]*\]\]/g, "")
    // `sanearHistorial` agrega esta segunda marca a los turnos VIEJOS que afirmaban una propuesta
    // sin haberla registrado. Igual que la otra: contexto para el modelo, invisible para el vet.
    .replace(/\s*\[\[sin-propuesta:[^\]]*\]\]/g, "")
    .trim()
}

function TextBlocks({ text, kp }: { text: string; kp: string }) {
  const limpio = sinMarcas(text)
  if (!limpio) return null
  return (
    // SIN BURBUJA. La respuesta se lee como texto sobre la página, que es lo que distingue a un chat
    // tipo ChatGPT de una mensajería: la única burbuja del hilo es la del veterinario, y por eso se
    // ve de un vistazo quién dijo qué sin encajonar también la respuesta, que es lo largo y lo que
    // hay que leer. El avatar circular sigue anclándola al margen izquierdo.
    //
    // SIN RAYAS ENTRE PÁRRAFOS. Antes cada bloque llevaba `border-b`, así que una respuesta en prosa
    // se leía como una planilla: tres líneas horizontales entre tres oraciones. Los párrafos se
    // separan con espacio, que es como se separan los párrafos. Las viñetas conservan su punto.
    // 13,5px CON INTERLÍNEA 1,55, no 15px/leading-7. Es la densidad del prototipo, y en una
    // superficie donde el vet lee párrafos largos mientras atiende, 15px con interlínea de 28px
    // obliga a desplazarse el doble para la misma respuesta.
    <div className="flex flex-col gap-3 text-[13.5px] leading-[1.55]">
      {splitBlocks(limpio).map((blk, j) =>
        blk.heading ? (
          <div key={j} className="text-[13px] font-semibold tracking-tight">
            {renderInline(blk.text, [], `${kp}h${j}`)}
          </div>
        ) : blk.bullet ? (
          <div key={j} className="flex gap-2">
            <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-brand" />
            <div className="min-w-0 flex-1">{renderInline(blk.text, [], `${kp}b${j}`)}</div>
          </div>
        ) : (
          <div key={j}>{renderInline(blk.text, [], `${kp}p${j}`)}</div>
        ),
      )}
    </div>
  )
}

// Render de un part de tool según su estado de streaming:
// - input-streaming / input-available → spinner pequeño (la tool está en curso)
// - output-available con {action_id, status:"proposed"} → tarjeta de aprobación
// - output-available de lectura → NADA (el proceso interno no es contenido para el vet)
// - output-error / {error} → línea discreta de fallo
function ToolPartView({ part }: { part: ToolUIPart }) {
  const toolName = String(getStaticToolName(part))
  const readLabel = READ_TOOL_LABELS[toolName]

  if (part.state === "input-streaming" || part.state === "input-available") {
    return (
      <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 shrink-0 animate-spin" />
        {readLabel ? `Consultando ${readLabel}…` : "Preparando una propuesta…"}
      </div>
    )
  }

  if (part.state === "output-error") {
    return (
      <div className="py-1 text-xs text-destructive">
        {readLabel ? `No se pudo consultar ${readLabel}` : "No se pudo preparar la propuesta"}: {part.errorText}
      </div>
    )
  }

  if (part.state === "output-available") {
    const proposed = asProposed(part.output)
    if (proposed) {
      return (
        <div className="py-1.5">
          <ActionApprovalCard
            action={{
              id: proposed.action_id,
              tool_name: toolName,
              summary: proposed.summary,
              payload: (part.input ?? {}) as Record<string, unknown>,
              status: "proposed",
            }}
          />
        </div>
      )
    }
    if (necesitaConexion(part.output)) {
      return (
        <div className="py-1.5">
          <ConnectEmailCard />
        </div>
      )
    }
    const err = outputError(part.output)
    if (err) {
      return (
        <div className="py-1 text-xs text-muted-foreground">
          {readLabel ? `No se pudo consultar ${readLabel}` : "No se pudo registrar la propuesta"}: {err}
        </div>
      )
    }
    // Una lectura que salió bien NO deja rastro en la conversación.
    //
    // Antes se quedaba un "Consultó la literatura veterinaria" permanente debajo de cada respuesta.
    // Eso es metadata de proceso, no contenido para el veterinario: le ensucia el hilo y compite con
    // lo que sí importa, que es la respuesta. El indicador de "Consultando…" mientras corre sí se
    // mantiene — ahí sí informa que el sistema está trabajando.
    //
    // Para depurar qué tools se usaron está el log del servidor y la traza en `rag_retrieval_log`.
    return null
  }

  return null
}

function AssistantMessage({ message, streaming }: { message: UIMessage; streaming: boolean }) {
  return (
    <div className="flex gap-3">
      {/* 26px Y CUADRADO-REDONDEADO, con la chispa. Era un círculo de 32 con la inicial "A".
          Sale del prototipo, y el cambio de forma importa más que el de tamaño: un círculo con una
          letra se lee como una PERSONA, y en un hilo donde el otro interlocutor es el veterinario
          eso confunde quién es quién. Un cuadrado con la chispa se lee como lo que es.

          El menta va en RELLENO SUAVE y no sólido: el menta pleno es el color de acción del sistema
          —lo usan los botones primarios— y gastarlo en un avatar que aparece en cada turno lo
          devalúa. */}
      <div className="mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-[8px] bg-brand-soft text-brand-text">
        <Sparkles className="size-3.5" aria-hidden />
      </div>
      <div className="flex min-w-0 max-w-[70ch] flex-1 flex-col gap-1.5">
        {/* La línea de autoría que el mockup pone SOBRE la burbuja. Sin ella, con dos o tres turnos
            seguidos el hilo se vuelve un muro sin puntos de referencia. */}
        <span className="text-xs font-medium text-fg-muted">Athos</span>
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return part.text ? <TextBlocks key={i} text={part.text} kp={`t${i}-`} /> : null
          }
          if (isStaticToolUIPart(part)) {
            return <ToolPartView key={part.toolCallId} part={part} />
          }
          return null // step-start, reasoning, etc.
        })}
        {streaming && (
          <div className="py-1">
            <span className="inline-block h-4 w-1.5 animate-pulse bg-foreground align-middle" />
          </div>
        )}
      </div>
    </div>
  )
}

// clinicId y patients llegan del server component (page.tsx): antes este componente hacía
// getUser -> profiles -> patients EN SERIE desde el navegador (3 round-trips al montar).
// clinicId entra solo por contrato de props: el agente deriva la clínica de la sesión.
export function Assistant({
  patients,
  threads = {},
  initialPatientId,
  saludo,
  contexto,
  tiraClinica,
  textoInicial,
}: {
  clinicId: string
  patients: AssistantPatient[]
  threads?: StoredThreads
  /** Paciente con el que abrir, del `?patient=` que pone el historial del sidebar. Ya viene
   *  validado contra los pacientes de la clínica. */
  initialPatientId?: string
  /** "Buenos días, María". Lo arma el server component, que es quien sabe la hora de Bogotá. */
  saludo?: string
  /** "Miércoles 5 de agosto · 9 citas · 2 cobros vencidos". Datos del día, no un eslogan. */
  contexto?: string
  /** `TiraClinica`, el riel de la derecha aplastado a una línea. Se pinta sola por debajo de `xl`,
   *  que es justo donde el riel grande desaparece. Va acá dentro y no envolviendo esta pantalla
   *  porque el alto es `h-[calc(100svh-var(--header-height))]`: cualquier cosa apilada por fuera
   *  empujaría el compositor fuera de la ventana. */
  tiraClinica?: React.ReactNode
  /** Petición ya redactada que otra pantalla dejó lista (`?pedir=`). Se escribe, no se envía. */
  textoInicial?: string
}) {
  const [patientId, setPatientId] = useState<string>(
    initialPatientId ?? patients[0]?.id ?? GENERAL,
  )
  const [input, setInput] = useState<string>(textoInicial ?? "")
  const threadRef = useRef<HTMLDivElement>(null)

  // useChat contra el agente. Cambiar de paciente cambia el `id` → el hook crea un Chat nuevo, y
  // `messages` lo siembra con la conversación YA guardada de ese paciente. Antes se montaba vacío,
  // así que al recargar la página el veterinario perdía de vista el hilo aunque siguiera en la base.
  // La consulta general no tiene historial a propósito: el backend la trata como sin estado.
  const { messages, sendMessage, status, error, stop } = useChat({
    id: `athos-${patientId}`,
    messages: threads[patientId] ?? [],
    transport,
    onError: (e) => toast.error(`No se pudo consultar a Athos: ${e.message}`),
  })

  const busy = status === "submitted" || status === "streaming"

  // El plan de la clínica llega resuelto desde el layout: sin consulta y sin instante de "no sé
  // todavía" en el que el compositor dejaría pasar un mensaje.
  const { puede: puedeUsarAthos } = useCapacidad("athos")
  const { pedirPro, ventana } = useModalPro("athos")

  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight })
  }, [messages, status])

  const patient = patients.find((p) => p.id === patientId)
  const isGeneral = !patient // consulta general: sin ficha ni memoria de paciente

  // QUÉ PACIENTE RESOLVIÓ ATHOS POR SU CUENTA. Sale de sus propias llamadas a herramientas
  // (`search_patients`, `get_patient_summary`), que ya viajan en los `parts` de cada mensaje: no
  // cuesta ni un canal nuevo ni una query. Es el punto que abrió la reunión del 17-ago — Athos
  // detectaba el contexto desde hacía rato y el veterinario no tenía forma de verlo.
  const detectado = useMemo(() => pacienteDetectado(messages), [messages])

  function send() {
    const text = input.trim()
    if (!text) {
      toast.error("Escribe una pregunta.")
      return
    }
    if (busy) return

    // EL GATE DEL PLAN, ANTES DE MANDAR NADA. Una clínica en free escribe, aprieta Enter y recibe
    // la ventana de invitación a Pro.
    //
    // **NO SE BORRA LO ESCRITO.** `setInput("")` queda del otro lado del corte a propósito: el vet
    // redactó una pregunta y perderla al chocar contra el muro de pago es castigarlo por intentar.
    // Si sube de plan, vuelve y la pregunta sigue ahí.
    //
    // Esto es interfaz, no seguridad: la ruta corta igual con 402. Lo que evita es el viaje y el
    // mensaje de error crudo.
    if (!puedeUsarAthos) {
      pedirPro()
      return
    }

    setInput("")
    // El agente deriva la clínica de la sesión; aquí solo viaja el contexto de paciente.
    void sendMessage(
      { text },
      { body: { patientId: isGeneral ? null : patientId, source: "chat" } },
    )
  }

  const lastMessage = messages[messages.length - 1]
  const vacio = messages.length === 0

  // EL COMPOSITOR VIVE EN UNA VARIABLE porque se pinta en DOS SITIOS: en el medio de la pantalla
  // mientras no hay conversación, y al pie en cuanto la hay. Es la forma del prototipo, y no es
  // capricho — con el chat vacío, un campo pegado al borde de abajo deja el centro de la pantalla
  // ocupado por un cartel que nadie lee, que es exactamente de lo que se quejó David:
  // «prefiero dejarlo solo en blanco o poner solo el loguito».
  //
  // La pastilla lleva el borde y el foco; el textarea va sin los suyos, así el conjunto se lee como
  // UN control y no como dos piezas sueltas. Y la barra de acciones va DEBAJO del campo, no al lado:
  // con el botón al lado, el campo no puede crecer sin empujarlo.
  const compositor = (
    <div className="rounded-2xl border border-line bg-surface text-left shadow-popover transition focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
      <Textarea
        id="pedir-a-athos"
        aria-label="Pedirle algo a Athos"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          // Enter envía y Shift+Enter hace salto de línea, que es lo que espera cualquiera que haya
          // usado un chat. Antes exigía Ctrl/Cmd+Enter: un atajo que nadie descubre y que deja al
          // vet apretando Enter y viendo cómo su pregunta se convierte en un párrafo.
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            send()
          }
        }}
        rows={vacio ? 2 : 1}
        placeholder={
          vacio
            ? "Pregúntale a Athos… (p. ej. «resúmeme el historial de Luna antes de su cita»)"
            : "Responder a Athos…"
        }
        className="max-h-48 w-full resize-none border-0 bg-transparent px-4 pb-1 pt-3.5 text-[13.5px] shadow-none focus-visible:ring-0 dark:bg-transparent"
      />
      <div className="flex items-center gap-1.5 px-2.5 pb-2.5 pt-1.5">
        <div className="flex-1" />
        <Button
          onClick={send}
          disabled={busy || !input.trim()}
          size="sm"
          className="h-[30px] shrink-0 rounded-[7px] px-3 text-[12.5px]"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <>
              Enviar
              <Send className="size-3.5" aria-hidden />
            </>
          )}
        </Button>
      </div>
    </div>
  )

  return (
    // Llena el ancho en vez de ser una columna de 3xl centrada: al lado va el riel de la clínica, y
    // dos bloques centrados con aire a los costados leerían como dos páginas pegadas.
    <div className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      {/* Encabezado: SALUDO CON DATOS, que es lo que el mockup pone acá. No dice "Athos" —
          el sidebar ya lo dice, y repetir el nombre de la sección gasta la línea más visible de la
          pantalla en información que el vet ya tiene. */}
      {/* CON EL CHAT VACÍO EL SALUDO NO VA ACÁ, va en el hero del medio: dos encabezados apilados
          —uno arriba y otro en el centro— son la misma información dicha dos veces, y la de arriba
          es la que el vet no está mirando. Empezada la conversación vuelve, porque ahí el centro de
          la pantalla es el hilo. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          {!vacio && (
            <>
              <h1 className="font-display text-[28px] font-medium leading-[1.2] tracking-[-0.01em] text-fg">
                {saludo ?? "Athos"}
              </h1>
              <p className="mt-0.5 text-sm text-fg-muted">
                {contexto ?? "Athos propone — tú apruebas. Tu criterio decide."}
              </p>
            </>
          )}
        </div>
        {/* El contexto: lo elegido Y lo que Athos detectó solo. Ver `selector-de-contexto.tsx`. */}
        <SelectorDeContexto
          pacientes={patients}
          patientId={isGeneral ? null : patientId}
          detectado={detectado}
          hayConversacion={messages.length > 0}
          onElegir={(id) => {
            void stop() // si había un stream en curso, córtalo antes de resetear
            setPatientId(id ?? GENERAL) // el cambio de id de useChat cambia el hilo
          }}
        />
      </div>

      {tiraClinica}


      {/* Aviso de contexto: memoria del hilo (con paciente) o consulta general */}
      <div className="flex items-center gap-2 rounded-lg border border-line-soft bg-brand-soft px-3 py-2 text-xs text-fg-muted">
        <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-brand" />
        {patient ? (
          <span>
            <strong className="font-medium text-fg">Hilo con memoria</strong> — recuerdo el contexto
            de {patient.name} y las respuestas anteriores de esta conversación.
          </span>
        ) : (
          <span>
            <strong className="font-medium text-fg">Consulta general</strong> — respondo dudas médicas
            con literatura veterinaria citada, sin ficha de un paciente.
          </span>
        )}
      </div>

      {/* Hilo de conversación. Sin borde ni fondo propios: en el mockup la conversación no vive
          dentro de una card, ocupa la pantalla. El único borde de esta pantalla es el que separa
          el compositor abajo y el riel a la derecha.

          EL ANCHO DE LECTURA VIVE ACÁ, EN LOS HIJOS, no en el contenedor de la pantalla.

          Es lo que hace convivir las dos cosas que esta pantalla tiene que ser a la vez. La pantalla
          llena el ancho porque al lado va el riel de la clínica (320px); si se fijara `max-w-3xl`
          arriba —como hacía el chat antes de #87— no habría lugar para el riel. Pero sin ningún tope,
          en un monitor de 1920 quedan ~1300px de texto por línea: muy por encima de cualquier medida
          legible, y justo en la superficie donde el vet lee párrafos largos.

          Por eso el tope va en `[&>*]`: cada turno se centra en una columna de 3xl dentro de un hilo
          que ocupa todo el ancho. Los chips y el compositor llevan el MISMO tope unas líneas abajo —
          si no, el hilo queda angosto y centrado con un compositor ancho debajo, que se ve peor que
          no haber hecho nada. */}
      <div
        ref={threadRef}
        className="flex flex-1 flex-col gap-[18px] overflow-y-auto [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-[780px]"
      >
        {/* EL INICIO DE ATHOS. Era un icono gris con un párrafo de tres renglones explicando de qué
            es capaz — o sea un cartel en el centro de la pantalla, que es justo lo que David pidió
            sacar: «prefiero dejarlo solo en blanco o poner solo el loguito».
            El hero del prototipo lo resuelve mejor que dejarlo en blanco: en vez de explicar lo que
            Athos puede hacer, lo INVITA a pedirlo — el campo está en el centro, con cuatro atajos
            debajo, y se aprende usándolo. */}
        {vacio && (
          <div className="m-auto flex w-full max-w-[640px] flex-col items-center text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft px-[11px] py-1 text-[11.5px] font-semibold tracking-[0.04em] text-brand-text">
              <Sparkles className="size-[13px]" aria-hidden />
              Athos · copiloto clínico
            </span>
            <h1 className="mt-4 font-display text-[30px] font-semibold leading-[1.12] tracking-[-0.025em] text-fg">
              {saludo ? `${saludo}, ¿en qué trabajamos?` : "¿En qué trabajamos hoy?"}
            </h1>
            <p className="mt-1.5 text-sm text-fg-muted">
              {contexto ?? "Descríbele un caso, dicta una nota o pregúntale lo que necesites."}
            </p>

            <div className="mt-[22px] w-full text-left">{compositor}</div>
          </div>
        )}

        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-end">
              {/* La única burbuja del hilo: rellena y sin borde, que es lo que la separa del fondo
                  ahora que la respuesta de Athos no tiene caja.
                  LA ESQUINA DE ABAJO-DERECHA VA RECTA (4px contra 14px). Es el detalle del prototipo
                  que hace que la burbuja APUNTE a quien la escribió, sin necesidad de un avatar del
                  lado del vet — que es lo que deja el hilo con un solo avatar y sin simetría falsa. */}
              <div className="max-w-[80%] whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-normal">
                {msg.parts
                  .filter((p): p is Extract<(typeof msg.parts)[number], { type: "text" }> => p.type === "text")
                  .map((p) => p.text)
                  .join("")}
              </div>
            </div>
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              streaming={status === "streaming" && msg.id === lastMessage?.id}
            />
          ),
        )}

        {/* Con el MISMO avatar que las respuestas: así el turno que está por llegar ocupa el lugar
            que va a ocupar, y el hilo no salta cuando llega el primer token. */}
        {status === "submitted" && (
          <div className="flex items-center gap-[11px] text-[13px] text-fg-faint">
            <span
              aria-hidden
              className="grid size-[26px] shrink-0 place-items-center rounded-[8px] bg-brand-soft text-brand-text"
            >
              <Loader2 className="size-3.5 animate-spin" />
            </span>
            Athos está pensando…
          </div>
        )}

        {error && (
          <div className="text-xs text-destructive">
            No se pudo consultar a Athos: {error.message}
          </div>
        )}

        {/* Lo que quedó esperando aprobación, leído de athos_actions. Las tarjetas del streaming
            se pierden al recargar (solo se persiste el texto del turno); esto no. */}
        <PendingActions recargarToken={messages.length} />
      </div>

      {/* Compositor. Franja separada por una línea, como en el mockup: la conversación termina y
          acá empieza la entrada. Antes era una card con sombra flotando sobre otra card. */}
      {/* SUGERENCIAS PERSISTENTES, no sólo en el estado vacío.
          Antes desaparecían con el primer mensaje — o sea justo cuando el vet ya vio de qué es capaz
          Athos y podría querer pedirle lo siguiente. En el mockup viven bajo el briefing y son la
          forma principal de operar. Se ocultan mientras Athos responde: ofrecer otra cosa a mitad de
          una respuesta invita a pisarla. */}
      {!busy && (
        <div className="mx-auto flex w-full max-w-[780px] flex-wrap justify-center gap-[7px]">
          {(patient
            ? [
                `Resume la ficha de ${patient.name}`,
                `¿Qué debería revisar hoy en ${patient.name}?`,
                `Agenda un control para ${patient.name} la próxima semana`,
              ]
            : [
                "¿Qué citas hay hoy?",
                "¿Cuáles son los horarios de la clínica?",
                "¿Qué dice la literatura sobre otitis por Malassezia?",
              ]
          ).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setInput(s)}
              className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] font-medium text-fg-muted transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* CON MENSAJES el compositor va al pie, separado por una línea. En vacío no se pinta acá:
          ya está en el medio, dentro del hero. */}
      {!vacio && (
      <div className="-mx-4 mt-auto border-t border-line px-4 pt-4 md:-mx-6 md:px-6">
       <div className="mx-auto w-full max-w-[780px]">
        {compositor}
        {/* LA ADVERTENCIA APARECE AL ESCRIBIR, no al cargar la pantalla.
            Un aviso permanente de "esto es de pago" convierte la pantalla entera en un cartel y se
            deja de leer a los dos días. Enganchado a que haya texto, aparece en el único momento en
            que sirve: cuando el vet está por mandar algo y conviene que sepa qué va a pasar antes
            de apretar Enter, en vez de descubrirlo con una ventana en la cara.

            Ocupa el lugar de la nota de "Athos propone — tú apruebas" en vez de sumarse: dos líneas
            de letra chica bajo el compositor no las lee nadie, y con el plan en free la que importa
            es ésta. */}
        {!puedeUsarAthos && input.trim() ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-brand-text">
            <Sparkles className="size-3 shrink-0" aria-hidden />
            Athos es parte del plan Pro. Al enviar te vamos a mostrar cómo activarlo.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-fg-faint">
            Athos propone — tú apruebas. Ninguna acción se ejecuta sin tu confirmación.
          </p>
        )}
       </div>
      </div>
      )}
      {ventana}
    </div>
  )
}
