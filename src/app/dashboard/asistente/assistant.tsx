"use client"

import { useEffect, useRef, useState } from "react"
import { useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  getStaticToolName,
  isStaticToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import { Bot, Loader2, Send, Sparkles } from "lucide-react"
import { toast } from "sonner"

import { renderInline, splitBlocks } from "@/components/athos/rich-text"
import { ActionApprovalCard } from "@/components/athos/action-approval-card"
import { ConnectEmailCard } from "@/components/athos/connect-email-card"
import { PendingActions } from "@/components/athos/pending-actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

import type { StoredThreads } from "@/lib/athos-history"
import { CONEXION_CORREO } from "@/lib/athos-agent/conversacion"
import { useCapacidad } from "@/components/planes/plan-provider"
import { useModalPro } from "@/components/planes/modal-subir-a-pro"

export type AssistantPatient = { id: string; name: string; species: string }

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
    <div className="flex flex-col gap-3 text-[15px] leading-7">
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
      {/* Avatar del mockup: CÍRCULO en menta suave con la inicial, no un cuadrado menta relleno con
          un icono de robot. El menta relleno es el color de ACCIÓN en este sistema —lo usan los
          botones primarios— y gastarlo en un avatar que aparece en cada turno lo devalúa. */}
      <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-brand-soft text-[13px] font-semibold text-brand-text">
        A
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
  riel,
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
  /** El riel de configuración de la clínica. Se recibe ya renderizado desde el server component
   *  porque calcula el progreso con datos, y este componente es de cliente. */
  riel?: React.ReactNode
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

  return (
    // Llena el ancho en vez de ser una columna de 3xl centrada: al lado va el riel de la clínica, y
    // dos bloques centrados con aire a los costados leerían como dos páginas pegadas.
    <div className="flex h-[calc(100svh-var(--header-height))] min-w-0 flex-1 flex-col gap-4 p-4 md:p-6">
      {/* Encabezado: SALUDO CON DATOS, que es lo que el mockup pone acá. No dice "Athos" —
          el sidebar ya lo dice, y repetir el nombre de la sección gasta la línea más visible de la
          pantalla en información que el vet ya tiene. */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[28px] font-medium leading-[1.2] tracking-[-0.01em] text-fg">
            {saludo ?? "Athos"}
          </h1>
          <p className="mt-0.5 text-sm text-fg-muted">
            {contexto ?? "Athos propone — tú apruebas. Tu criterio decide."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {patient ? (
            <Badge variant="secondary">Contexto · {patient.name}</Badge>
          ) : (
            <Badge variant="outline">Consulta general</Badge>
          )}
          <Select
            value={patientId}
            onValueChange={(v) => {
              const nv = v ?? GENERAL
              if (nv === patientId) return // re-seleccionar lo mismo no borra el hilo
              void stop() // si había un stream en curso, córtalo antes de resetear
              setPatientId(nv) // el cambio de id de useChat resetea el hilo
            }}
            items={[
              { label: "Consulta general (sin paciente)", value: GENERAL },
              ...patients.map((p) => ({ label: `${p.name} · ${p.species}`, value: p.id })),
            ]}
          >
            <SelectTrigger size="sm" className="min-w-52">
              <SelectValue placeholder="Contexto" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GENERAL}>Consulta general (sin paciente)</SelectItem>
              {patients.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.species}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {tiraClinica}

      {riel}

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
        className="flex flex-1 flex-col gap-5 overflow-y-auto [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-3xl"
      >
        {messages.length === 0 && (
          <div className="m-auto flex max-w-md flex-col items-center gap-3 text-center">
            <Bot className="size-6 text-fg-faint" />
            <p className="text-sm text-fg-muted">
              {patient
                ? `Pregúntame sobre ${patient.name} o una duda médica general. Puedo consultar su ficha, la agenda o la literatura, y proponerte acciones (citas, mensajes) que tú apruebas.`
                : "Pregúntame una duda médica general, o elige un paciente arriba para razonar con su ficha. Respondo con literatura citada y verificable — nunca un diagnóstico cerrado."}
            </p>
          </div>
        )}

        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-end">
              {/* La única burbuja del hilo. Muy redondeada y sin borde, como la del usuario en
                  ChatGPT: rellena en vez de delineada, que es lo que la separa del fondo ahora que
                  la respuesta de Athos no tiene caja. */}
              <div className="max-w-[80%] whitespace-pre-wrap rounded-3xl bg-surface-2 px-4 py-2.5 text-[15px] leading-6">
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

        {status === "submitted" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Athos está pensando…
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
        <div className="mx-auto flex w-full max-w-3xl flex-wrap gap-2">
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
            <Button
              key={s}
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setInput(s)}
              className="h-10 font-normal"
            >
              {s}
            </Button>
          ))}
        </div>
      )}

      <div className="-mx-4 mt-auto border-t border-line px-4 pt-4 md:-mx-6 md:px-6">
       <div className="mx-auto w-full max-w-3xl">
        {/* La etiqueta va ARRIBA y visible, como en el mockup, no escondida en el placeholder: un
            placeholder desaparece al escribir la primera letra y con él la única pista de qué es
            ese campo. */}
        <label htmlFor="pedir-a-athos" className="mb-1.5 block text-[13px] font-medium">
          Pedirle algo a Athos
        </label>
        {/* El campo y el botón viven DENTRO de una sola pastilla, como el compositor de ChatGPT: se
            lee como un control y no como dos piezas sueltas. El borde y el foco los lleva la
            pastilla, así que el textarea va sin los suyos. El botón queda circular y sin la palabra
            "Enviar" — la lleva en `aria-label`, que es lo que necesita quien navega con lector. */}
        <div className="flex items-end gap-2 rounded-3xl border border-line bg-surface py-2 pl-4 pr-2 focus-within:border-brand">
          <Textarea
            id="pedir-a-athos"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send()
            }}
            rows={1}
            placeholder="Agenda el control de Luna la próxima semana"
            className="max-h-40 min-h-9 flex-1 resize-none self-center border-0 bg-transparent px-0 py-1.5 text-[15px] shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          <Button
            onClick={send}
            disabled={busy}
            size="icon"
            aria-label="Enviar"
            className="size-9 shrink-0 rounded-full"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
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
      {ventana}
    </div>
  )
}
