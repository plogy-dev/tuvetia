"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Chat, useChat } from "@ai-sdk/react"
import {
  DefaultChatTransport,
  getStaticToolName,
  isStaticToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from "ai"
import { ArrowUp, Loader2, Mic, Paperclip, Sparkles, X } from "lucide-react"

import { BrandGlyph } from "@/components/brand-glyph"
import { toast } from "sonner"

import { athosIndexarDocumento } from "@/lib/athos"
import { useDictado } from "@/lib/athos-dictado"
import {
  ADJUNTOS_ACEPTA,
  MAX_ADJUNTOS,
  bloqueDeAdjuntos,
  leerAdjunto,
  type Adjunto,
} from "@/lib/athos-adjuntos"

import { renderInline, splitBlocks } from "@/components/athos/rich-text"
import { Cuestionario } from "@/components/athos/cuestionario"
import { extraerOpciones, sinMarcas } from "@/components/athos/opciones"
import { Pensando } from "@/components/athos/pensando"
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

// Transport único hacia el agente VetGPT (/api/athos/agent, Vercel AI SDK). El patientId NO va
// aquí: cambia con el selector, así que viaja en el body de cada sendMessage.
const transport = new DefaultChatTransport({ api: "/api/athos/agent" })

// ── UN `Chat` VIVO POR HILO, no uno nuevo por cambio de `id` ────────────────────────────────────
//
// En esta versión del SDK, `useChat` RECREA el objeto Chat cada vez que cambia el `id`, sembrándolo
// solo con el prop `messages` de ese render. Eso producía la pérdida reportable con dos clics:
// mandar mensajes en «Consulta general», elegir un paciente, volver a general → el hilo aparecía
// VACÍO (los mensajes seguían en la base, pero la siembra venía de props cargadas al entrar a la
// página). Con el mapa, volver a un hilo de la misma sesión recupera su instancia con TODO lo
// hablado — incluida una respuesta que terminó de llegar mientras se miraba otro hilo.
//
// El mapa vive a nivel de módulo (sobrevive a los remontajes de la página) y crece con los hilos
// visitados en la sesión: decenas de objetos chicos, no un costo. Un reload limpia y resiembra
// desde el servidor, que vuelve a ser la verdad.
const chatsVivos = new Map<string, Chat<UIMessage>>()

function chatDe(id: string, semilla: UIMessage[], onError: (e: Error) => void): Chat<UIMessage> {
  let c = chatsVivos.get(id)
  if (!c) {
    c = new Chat<UIMessage>({ id, transport, messages: semilla, onError })
    chatsVivos.set(id, c)
  }
  return c
}

// Etiquetas en español de las tools de LECTURA. Se usan MIENTRAS la tool corre ("Consultando X…")
// y para nombrar el fallo si algo sale mal — no para dejar constancia cuando sale bien.
// Las tools que no están aquí son de escritura: proponen acciones que el vet aprueba.
const READ_TOOL_LABELS: Record<string, string> = {
  search_patients: "pacientes de la clínica",
  search_patients_by_features: "pacientes por sus señas",
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
// `sinMarcas` y `extraerOpciones` viven en components/athos/opciones.ts desde la auditoría del
// 26-ago: el widget y el onboarding pintaban el bloque del cuestionario CRUDO por no compartirlos.

function TextBlocks({
  text,
  kp,
  onOpcion,
  streaming = false,
}: {
  text: string
  kp: string
  onOpcion?: (s: string) => void
  streaming?: boolean
}) {
  const { limpio, preguntas } = extraerOpciones(sinMarcas(text), streaming)
  if (!limpio && preguntas.length === 0) return null
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
      {/* El cuestionario se pinta SOLO cuando hay quien lo reciba (el último turno, con VetGPT
          quieto): en turnos viejos el bloque se recorta del texto pero no se ofrece — responder
          una pregunta de hace tres turnos ya no tiene destinatario. */}
      {preguntas.length > 0 && onOpcion && (
        <Cuestionario preguntas={preguntas} onResponder={onOpcion} />
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

function AssistantMessage({
  message,
  streaming,
  onOpcion,
}: {
  message: UIMessage
  streaming: boolean
  /** Recibe la opción clicada del bloque ```opciones``` — solo llega para el último turno. */
  onOpcion?: (s: string) => void
}) {
  return (
    <div className="flex gap-3">
      {/* 26px Y CUADRADO-REDONDEADO, con la chispa. Era un círculo de 32 con la inicial "A".
          Sale del prototipo, y el cambio de forma importa más que el de tamaño: un círculo con una
          letra se lee como una PERSONA, y en un hilo donde el otro interlocutor es el veterinario
          eso confunde quién es quién. Un cuadrado con la chispa se lee como lo que es.

          El menta va en RELLENO SUAVE y no sólido: el menta pleno es el color de acción del sistema
          —lo usan los botones primarios— y gastarlo en un avatar que aparece en cada turno lo
          devalúa.

          EL GLIFO DE LA MARCA, NO LA CHISPA. David, 25-ago: «en vez de una estrella debe ser el
          logo de tuvetia». La burbuja flotante ya lo tenía; éste era el que faltaba — el avatar
          que se ve en CADA respuesta. `currentColor` para heredar el text-brand-text del
          contenedor, igual que en la burbuja. */}
      <div className="mt-0.5 grid size-[26px] shrink-0 place-items-center rounded-[8px] bg-brand-soft text-brand-text">
        <BrandGlyph className="size-3.5" fill="currentColor" />
      </div>
      <div className="flex min-w-0 max-w-[70ch] flex-1 flex-col gap-1.5">
        {/* La línea de autoría que el mockup pone SOBRE la burbuja. Sin ella, con dos o tres turnos
            seguidos el hilo se vuelve un muro sin puntos de referencia. */}
        <span className="text-xs font-medium text-fg-muted">VetGPT</span>
        {message.parts.map((part, i) => {
          if (part.type === "text") {
            return part.text ? (
              <TextBlocks key={i} text={part.text} kp={`t${i}-`} onOpcion={onOpcion} streaming={streaming} />
            ) : null
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
  clinicId,
  patients,
  threads = {},
  initialPatientId,
  saludo,
  contexto,
  tiraClinica,
  textoInicial,
  claveNueva,
  hiloGeneral,
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
   *  porque el alto de la pantalla está acotado al del área de contenido: cualquier cosa apilada por fuera
   *  empujaría el compositor fuera de la ventana. */
  tiraClinica?: React.ReactNode
  /** Petición ya redactada que otra pantalla dejó lista (`?pedir=`). Se escribe, no se envía. */
  textoInicial?: string
  /** `?nuevo=` de «Nuevo chat con VetGPT»: un valor siempre distinto (timestamp) que abre una
   *  conversación GENERAL fresca. Entra al id del hilo, así el hook crea un chat vacío en vez de
   *  volver al hilo general que quedó en memoria. */
  claveNueva?: string
  /** `?chat=` del historial: un chat GENERAL guardado (clave 0092) con sus mensajes ya sembrados,
   *  para volver y seguir la conversación donde quedó. */
  hiloGeneral?: { key: string; messages: UIMessage[] }
}) {
  // CONSULTA GENERAL POR DEFECTO, no el primer paciente (decisión de la reunión del 24-ago: el
  // vet abre el chat para preguntar lo que sea; encontrarse con un paciente pre-seleccionado que
  // no eligió tiñe la respuesta con un contexto equivocado). Cambiar de paciente es SIEMPRE una
  // acción manual del vet en el selector — la única excepción es llegar con `?patient=` explícito.
  const [patientId, setPatientId] = useState<string>(initialPatientId ?? GENERAL)
  const [input, setInput] = useState<string>(textoInicial ?? "")

  // ── EL CLIC EN EL HISTORIAL TIENE QUE FUNCIONAR TAMBIÉN ESTANDO YA ACÁ ──────────────────────
  //
  // `?patient=` llega como prop, y `useState` sólo lo lee al MONTAR. Con la app recién abierta eso
  // alcanza; pero el historial del sidebar navega en suave (misma pantalla, otra query), el
  // componente NO se remonta, y el clic no hacía nada — «está fallando poder ir a los chats
  // existentes» (David, 25-ago).
  //
  // Se sincroniza con el patrón de React para «estado que se ajusta cuando cambia un prop»:
  // setState DURANTE el render, comparando contra el prop anterior. No un useEffect —
  // `react-hooks/set-state-in-effect` lo rechaza con razón: esto no es un efecto, es derivar
  // estado, y hacerlo acá evita el render de más con el paciente viejo.
  //
  // Un remount con `key` en el padre haría lo mismo en una línea, pero tiraría lo que el vet tenga
  // a medias en OTRO estado (el texto tecleado, los adjuntos leídos): cambiar de conversación no
  // debería costarle sus adjuntos.
  const [patientDeLaUrl, setPatientDeLaUrl] = useState(initialPatientId)
  if (initialPatientId !== patientDeLaUrl) {
    setPatientDeLaUrl(initialPatientId)
    if (initialPatientId) setPatientId(initialPatientId)
  }
  // «Nuevo chat» = mismo patrón que arriba, para `?nuevo=`: al cambiar la clave se vuelve a la
  // consulta general (el chat fresco arranca sin paciente; elegirlo es del selector). El hilo
  // vacío lo garantiza el id del useChat de abajo, que incorpora la clave.
  const [claveVista, setClaveVista] = useState(claveNueva)
  if (claveNueva !== claveVista) {
    setClaveVista(claveNueva)
    if (claveNueva) setPatientId(GENERAL)
  }
  // Volver a un chat general del historial (`?chat=`): mismo patrón otra vez.
  const [hiloVisto, setHiloVisto] = useState(hiloGeneral?.key)
  if (hiloGeneral?.key !== hiloVisto) {
    setHiloVisto(hiloGeneral?.key)
    if (hiloGeneral) setPatientId(GENERAL)
  }

  // ── LA CLAVE DEL HILO GENERAL VIGENTE (0092) ────────────────────────────────────────────────
  // Toda conversación general tiene identidad desde que nace, para que al quedar atrás sea un
  // botón del historial al que se vuelve. Prioridad: el chat retomado (?chat=) > el chat nuevo
  // (?nuevo=) > una clave local generada al montar (la visita directa a la pantalla también es
  // una conversación que mañana se quiere retomar). Viaja como `conversationKey` en cada envío y
  // la ruta la persiste como `thread_key`.
  const [claveLocal] = useState(() => `g${Date.now()}`)
  const claveDeHilo = hiloGeneral?.key ?? (claveNueva ? `g${claveNueva}` : claveLocal)
  const threadRef = useRef<HTMLDivElement>(null)

  // --- Dictado por micrófono (reunión 24-ago). El dictado APPENDEA sobre lo que había: la base se
  // congela al prender el mic, y estable+provisional se pintan encima de esa base en cada avance.
  const baseDictado = useRef("")
  const dictado = useDictado(({ estable, provisional }) => {
    setInput(`${baseDictado.current}${estable}${provisional}`)
  })

  // --- Documentos adjuntos (reunión 24-ago). Se extraen a texto en el navegador y viajan como
  // bloque citado delante de la pregunta; ver lib/athos-adjuntos.ts para el porqué.
  const [adjuntos, setAdjuntos] = useState<Adjunto[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  async function agregarAdjuntos(files: FileList | null) {
    if (!files?.length) return
    // Contador LOCAL sembrado del estado (auditoría 26-ago): `adjuntos.length` es el closure del
    // render y no avanza dentro del loop — con 4 archivos elegidos y tope 2, los 4 se LEÍAN (los
    // escaneados/fotos facturando visión) y el setter descartaba los sobrantes en silencio
    // mientras su toast decía "listo". Ahora se corta ANTES de leer.
    let cupo = MAX_ADJUNTOS - adjuntos.length
    for (const f of Array.from(files)) {
      if (cupo <= 0) {
        toast.error(`Máximo ${MAX_ADJUNTOS} documentos por mensaje.`)
        break
      }
      // Toast de progreso: un txt es instantáneo, pero un PDF escaneado pasa por el lector con IA
      // y tarda varios segundos — sin señal, el vet vuelve a clickear o cree que se rompió.
      const t = toast.loading(`Leyendo ${f.name}…`)
      try {
        const adj = await leerAdjunto(f)
        cupo -= 1
        setAdjuntos((prev) => (prev.length >= MAX_ADJUNTOS ? prev : [...prev, adj]))
        toast.success(`${f.name} listo para enviar`, { id: t })
      } catch (e) {
        toast.error((e as Error).message, { id: t })
      }
    }
    if (fileRef.current) fileRef.current.value = "" // volver a elegir el mismo archivo debe funcionar
  }

  // useChat contra el agente. Cambiar de paciente cambia el `id` → el hook crea un Chat nuevo, y
  // `messages` lo siembra con la conversación YA guardada de ese paciente. Antes se montaba vacío,
  // así que al recargar la página el veterinario perdía de vista el hilo aunque siguiera en la base.
  // La consulta general no tiene historial a propósito: el backend la trata como sin estado.
  //
  // La clave de «Nuevo chat» entra al id SOLO en modo general: cada clic estrena un id → un hilo
  // vacío de verdad. Los hilos de paciente no la llevan — un paciente tiene UNA conversación
  // continua por diseño, y "nuevo chat" significa "quiero empezar de cero en general".
  // En modo general el id ES la clave del hilo (0092): cada «Nuevo chat» estrena una → hilo vacío
  // de verdad; volver del historial reutiliza la guardada → mismo hilo, sembrado con lo
  // persistido. Los hilos de paciente no llevan clave: un paciente tiene UNA conversación
  // continua por diseño.
  // `stop` no se usa (no hay botón de detener el stream todavía); se omite en vez de dejar la
  // variable muerta que el lint venía marcando.
  const { messages, sendMessage, status, error, regenerate } = useChat({
    // La instancia viene del mapa (ver `chatsVivos`): volver a un hilo de esta sesión conserva lo
    // hablado; la semilla del servidor solo aplica la PRIMERA vez que se visita cada hilo.
    chat: chatDe(
      patientId === GENERAL ? `athos-${claveDeHilo}` : `athos-${patientId}`,
      patientId === GENERAL
        ? hiloGeneral?.key === claveDeHilo
          ? hiloGeneral.messages
          : []
        : (threads[patientId] ?? []),
      (e) => toast.error(`No se pudo consultar a VetGPT: ${e.message}`),
    ),
    // Un render por CHUNK del SSE (decenas por segundo) re-parseaba el hilo entero — con 30+
    // turnos, el tecleo del stream se sentía a saltos. 60ms agrupa los chunks sin que se note.
    experimental_throttle: 60,
  })

  const busy = status === "submitted" || status === "streaming"

  // El plan de la clínica llega resuelto desde el layout: sin consulta y sin instante de "no sé
  // todavía" en el que el compositor dejaría pasar un mensaje.
  const { puede: puedeUsarAthos } = useCapacidad("athos")
  const { pedirPro, ventana } = useModalPro("athos")

  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    // Solo re-anclar si el vet YA estaba abajo: forzar el scroll en cada token le impedía subir a
    // releer la respuesta anterior mientras la nueva seguía llegando.
    const cercaDelFondo = el.scrollHeight - el.scrollTop - el.clientHeight < 160
    if (cercaDelFondo) el.scrollTo({ top: el.scrollHeight })
  }, [messages, status])

  const patient = patients.find((p) => p.id === patientId)
  const isGeneral = !patient // consulta general: sin ficha ni memoria de paciente

  // QUÉ PACIENTE RESOLVIÓ ATHOS POR SU CUENTA. Sale de sus propias llamadas a herramientas
  // (`search_patients`, `get_patient_summary`), que ya viajan en los `parts` de cada mensaje: no
  // cuesta ni un canal nuevo ni una query. Es el punto que abrió la reunión del 17-ago — VetGPT
  // detectaba el contexto desde hacía rato y el veterinario no tenía forma de verlo.
  const detectado = useMemo(() => pacienteDetectado(messages), [messages])

  // Los action_id de las propuestas que YA están pintadas inline en el hilo vivo. Se le pasan a
  // PendingActions para que no las repita: tras el 2º mensaje, PendingActions recarga e incluye la
  // propuesta del turno anterior —que sigue 'proposed' en la tabla y ya está arriba inline—, y la
  // misma acción aparecía DOS veces (la 2ª daba 409 al aprobar).
  const idsEnHilo = useMemo(() => {
    const ids = new Set<string>()
    for (const m of messages) {
      for (const part of m.parts ?? []) {
        if (isStaticToolUIPart(part) && part.state === "output-available") {
          const prop = asProposed(part.output)
          if (prop?.action_id) ids.add(prop.action_id)
        }
      }
    }
    return ids
  }, [messages])

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
    if (dictado.activo) dictado.alternar() // mandar con el mic abierto lo cierra
    // Los adjuntos viajan como bloque citado DELANTE de la pregunta (el agente es de texto).
    const conAdjuntos = adjuntos.length ? `${bloqueDeAdjuntos(adjuntos)}\n\n${text}` : text
    // Con PACIENTE en contexto, el documento además se indexa en su memoria semántica
    // (fire-and-forget): la consulta del mes que viene puede recordar este laboratorio.
    // En consulta general no: no hay ficha a la que colgarlo.
    if (adjuntos.length && !isGeneral) {
      for (const a of adjuntos) {
        void athosIndexarDocumento({ clinicId, patientId, nombre: a.nombre, texto: a.texto })
      }
    }
    setAdjuntos([])
    // El agente deriva la clínica de la sesión. `conversationKey` identifica el hilo (0092): en
    // general es la clave del hilo vigente; en paciente, su id — la ruta la persiste por turno.
    void sendMessage(
      { text: conAdjuntos },
      {
        body: {
          patientId: isGeneral ? null : patientId,
          source: "chat",
          conversationKey: isGeneral ? claveDeHilo : patientId,
        },
      },
    )
  }

  // La respuesta COMPUESTA del cuestionario (```opciones```) se envía directa (no rellena el
  // input): llega como "Pregunta: respuesta" por línea, todo junto y con un solo clic en
  // "Responder". Pasa por los mismos gates que send().
  function enviarOpcion(texto: string) {
    if (busy) return
    if (!puedeUsarAthos) {
      pedirPro()
      return
    }
    void sendMessage(
      { text: texto },
      {
        body: {
          patientId: isGeneral ? null : patientId,
          source: "chat",
          conversationKey: isGeneral ? claveDeHilo : patientId,
        },
      },
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
  // ── EL COMPOSITOR ─────────────────────────────────────────────────────────────────────────────
  //
  // UNA SOLA FILA, como el de ChatGPT. Antes eran dos: el campo arriba y una barra de acciones
  // debajo, y entre las dos la pastilla medía CIENTO TREINTA PÍXELES con el chat vacío — un tercio
  // del alto útil ocupado por una caja de texto que todavía no tiene texto. Lo que se lleva ese
  // espacio es justamente lo que hay que leer: las respuestas.
  //
  // Ahora los botones van EN LA MISMA LÍNEA que el campo y la pastilla arranca en ~52 px. La barra
  // debajo existía porque «con el botón al lado, el campo no puede crecer sin empujarlo»; eso se
  // resuelve con `items-end` — los botones se quedan abajo y el campo crece hacia arriba, que es
  // exactamente lo que hacen ChatGPT y Claude.
  //
  // `field-sizing-content` es lo que la hace crecer sola con lo que se escribe, sin medir alturas a
  // mano en un efecto. Donde el navegador no lo soporte, el `max-h-40` deja scroll: peor, pero no
  // peor que hoy.
  const compositor = (
    <div className="rounded-[26px] border border-line bg-surface text-left shadow-popover transition focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand-soft">
      {/* Chips de documentos ya extraídos, con su X. Van DENTRO de la pastilla: son parte del
          mensaje que está por salir, no un estado aparte de la pantalla. */}
      {adjuntos.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pt-3">
          {adjuntos.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11.5px] text-fg-muted"
            >
              <Paperclip className="size-3" aria-hidden />
              {a.nombre}
              <button
                type="button"
                aria-label={`Quitar ${a.nombre}`}
                // Por id, no por nombre (auditoría 26-ago): dos archivos homónimos y la X borraba ambos.
                onClick={() => setAdjuntos((prev) => prev.filter((x) => x.id !== a.id))}
                className="ml-0.5 rounded-full p-0.5 hover:bg-surface hover:text-fg"
              >
                <X className="size-3" aria-hidden />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* ── LA ALINEACIÓN, QUE ES LO QUE HABÍA QUE RESOLVER ──────────────────────────────────
          `items-start` y no `items-end`: con dos o tres renglones escritos, los controles bajaban
          con el campo y quedaban a la altura del ÚLTIMO — lejos del cursor y desalineados de todo
          lo demás. Arriba se quedan quietos mientras el texto crece hacia abajo.

          Y el alineado fino lo hacen los dos grupos con `h-10`, que es EXACTAMENTE lo que mide la
          primera línea del campo: `py-2` (8+8) más `leading-6` (24) = 40 px. Centrando dentro de
          esa caja, el clip, la pastilla, el micrófono y el botón de enviar caen los cuatro sobre el
          eje de la primera línea de texto, midan lo que midan.

          Hacerlo con márgenes sueltos —`mt-0.5` acá, `mt-1.5` allá— también alinea, pero se rompe
          en cuanto alguien toca el tamaño de la fuente o el alto de un botón. */}
      <div className="flex items-start gap-1.5 p-1.5">
        <div className="flex h-10 shrink-0 items-center gap-1">
          <input
            ref={fileRef}
            type="file"
            accept={ADJUNTOS_ACEPTA}
            multiple
            className="hidden"
            onChange={(e) => void agregarAdjuntos(e.target.files)}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Adjuntar documento"
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="size-9 shrink-0 rounded-full p-0 text-fg-muted"
          >
            <Paperclip className="size-4" aria-hidden />
          </Button>

          {/* EL CONTEXTO VIVE ACÁ, en el lugar donde Claude pone su selector de modo: pegado al clip,
              a la izquierda del campo. Antes eran dos controles flotando arriba a la derecha más una
              franja de ancho completo explicándolos — tres elementos para decir una cosa. */}
          <SelectorDeContexto
            compacto
            pacientes={patients}
            patientId={isGeneral ? null : patientId}
            detectado={detectado}
            hayConversacion={messages.length > 0}
            onElegir={(id) => {
              // SIN `stop()`: con el mapa de `chatsVivos`, el stream en curso sigue llegando a SU
              // instancia retenida y el turno se persiste al terminar (el abort hacía que el server
              // no guardara NI la pregunta NI la respuesta parcial — el intercambio se esfumaba de
              // la vista Y de la base). Al volver a ese hilo, la respuesta está completa.
              setPatientId(id ?? GENERAL) // el cambio de id de useChat cambia el hilo
            }}
          />
        </div>

        <Textarea
          id="pedir-a-athos"
          aria-label="Pedirle algo a VetGPT"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            // Enter envía y Shift+Enter hace salto de línea, que es lo que espera cualquiera que
            // haya usado un chat. Antes exigía Ctrl/Cmd+Enter: un atajo que nadie descubre y que
            // deja al vet apretando Enter y viendo cómo su pregunta se convierte en un párrafo.
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          rows={1}
          // EL MARCADOR ES CORTO. El de antes —con su ejemplo entre comillas— medía media línea de
          // más de lo que entra en una barra de una fila: se cortaba a mitad de palabra.
          placeholder={vacio ? "Pregúntale a VetGPT…" : "Responder a VetGPT…"}
          className="field-sizing-content max-h-40 min-h-0 flex-1 resize-none border-0 bg-transparent px-1 py-2 text-[14px] leading-6 shadow-none focus-visible:ring-0 dark:bg-transparent"
        />

          <div className="flex h-10 shrink-0 items-center gap-1">
        {/* El mic solo existe si el navegador trae la Web Speech API (ver lib/athos-dictado.ts). */}
          {dictado.soportado && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={dictado.activo ? "Detener dictado" : "Dictar por micrófono"}
              aria-pressed={dictado.activo}
              onClick={() => {
                if (!dictado.activo) baseDictado.current = input ? `${input.trimEnd()} ` : ""
                dictado.alternar()
              }}
              className={
                dictado.activo
                  ? "size-9 shrink-0 animate-pulse rounded-full p-0 text-destructive"
                  : "size-9 shrink-0 rounded-full p-0 text-fg-muted"
              }
            >
              <Mic className="size-4" aria-hidden />
            </Button>
          )}

          {/* REDONDO Y SÓLO ICONO. La palabra «Enviar» ocupaba el ancho de tres botones en una fila
              que ahora los tiene a todos; y con Enter para mandar, el botón es el respaldo, no la vía
              principal. El `aria-label` conserva el nombre para quien no ve el icono. */}
          <Button
            onClick={send}
            disabled={busy || !input.trim()}
            size="sm"
            aria-label="Enviar"
            className="size-9 shrink-0 rounded-full p-0"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <ArrowUp className="size-4" aria-hidden />
            )}
          </Button>
        </div>
      </div>
    </div>
  )

  return (
    // Llena el ancho en vez de ser una columna de 3xl centrada: al lado va el riel de la clínica, y
    // dos bloques centrados con aire a los costados leerían como dos páginas pegadas.
    //
    // ── EL ALTO SE HEREDA, NO SE CALCULA ─────────────────────────────────────────────────────
    //
    // Era `h-[calc(100svh-var(--header-height))]`, y de ahí salía la barra de desplazamiento de la
    // PÁGINA que no se iba con nada. La cuenta estaba mal por 16 px: con `variant="inset"` el
    // `SidebarInset` lleva `m-2`, así que el alto disponible no es `100svh - header` sino
    // `100svh - header - 16`. Dieciséis píxeles de más son suficientes para que el navegador pinte
    // la barra de la ventana entera, y desde ahí scrollea todo — encabezado y compositor incluidos.
    //
    // Arreglarlo restando otro `1rem` habría durado hasta el primer cambio de esa clase, y encima
    // sería incorrecto en móvil: el margen del inset es `md:` y abajo de eso no existe.
    //
    // `flex-1 min-h-0` no calcula nada: toma lo que quede después del encabezado, sea cual sea. El
    // `min-h-0` es lo que le permite encogerse por debajo de su contenido; sin él, el hilo la
    // volvería a empujar hacia afuera.
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-hidden p-4 md:p-6">
      {/* ── ACÁ VIVÍA EL ENCABEZADO ────────────────────────────────────────────────────────────
          Tres cosas se fueron de esta zona, y las tres por el mismo motivo: con una conversación en
          curso, lo único que importa es la conversación.

            · EL SALUDO Y LA LÍNEA DE DATOS. Sólo tienen sentido en un hilo limpio, y ahí ya viven
              en el hero del medio. Con mensajes arriba eran un encabezado que repetía lo que el
              hero ya había dicho, ocupando la franja más visible.
            · EL BADGE DE CONTEXTO Y «CAMBIAR CONTEXTO». Se mudaron ADENTRO del compositor, donde
              Claude pone su selector de modo: un solo control que dice el contexto y lo cambia.
            · LA FRANJA de «Consulta general — respondo dudas médicas…». Era una barra de ancho
              completo sobre el hilo para decir una frase que ahora vive en el `title` de esa
              pastilla. No se perdió: dejó de ocupar una fila.

          Nada se quitó — todo se movió a donde ya se estaba mirando. */}

      {tiraClinica}


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
        className="flex min-h-0 flex-1 flex-col gap-[18px] overflow-y-auto [&>*]:mx-auto [&>*]:w-full [&>*]:max-w-[780px]"
      >
        {/* EL INICIO DE ATHOS. Era un icono gris con un párrafo de tres renglones explicando de qué
            es capaz — o sea un cartel en el centro de la pantalla, que es justo lo que David pidió
            sacar: «prefiero dejarlo solo en blanco o poner solo el loguito».
            El hero del prototipo lo resuelve mejor que dejarlo en blanco: en vez de explicar lo que
            VetGPT puede hacer, lo INVITA a pedirlo — el campo está en el centro, con cuatro atajos
            debajo, y se aprende usándolo. */}
        {vacio && (
          <div className="m-auto flex w-full max-w-[640px] flex-col items-center text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-brand/25 bg-brand-soft px-[11px] py-1 text-[11.5px] font-semibold tracking-[0.04em] text-brand-text">
              <Sparkles className="size-[13px]" aria-hidden />
              VetGPT · copiloto clínico
            </span>
            <h1 className="mt-4 font-display text-[30px] font-semibold leading-[1.12] tracking-[-0.025em] text-fg">
              {saludo ? `${saludo}, ¿en qué trabajamos?` : "¿En qué trabajamos hoy?"}
            </h1>
            <p className="mt-1.5 text-sm text-fg-muted">
              {contexto ?? "Descríbele un caso, dicta una nota o pregúntale lo que necesites."}
            </p>

            <div className="mt-[22px] w-full text-left">{compositor}</div>

            {/* LAS PASTILLAS CUELGAN DEL COMPOSITOR, no del pie de la pantalla.
                Antes vivían al fondo, pegadas al borde inferior, a media pantalla del campo al que
                alimentan: se leían como una barra de la aplicación y no como sugerencias de lo que
                acabás de abrir. Debajo del campo y con aire, son lo que son. */}
            {/* Ya estamos dentro de `{vacio && …}`: acá sólo hace falta callarlas mientras VetGPT
                responde. Se quitan con la conversación empezada por pedido del cliente (24-ago,
                «si ya se hace una pregunta, que se quiten las pastillas»): con una respuesta en
                pantalla, las genéricas compiten con ella y el vet ya sabe qué pedir. */}
            {!busy && (
              <div className="mt-3 flex w-full flex-wrap justify-center gap-[7px]">
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
          </div>
        )}

        {messages.map((msg) =>
          msg.role === "user" ? (
            <div key={msg.id} className="flex justify-end">
              {/* La única burbuja del hilo: rellena y sin borde, que es lo que la separa del fondo
                  ahora que la respuesta de VetGPT no tiene caja.
                  LA ESQUINA DE ABAJO-DERECHA VA RECTA (4px contra 14px). Es el detalle del prototipo
                  que hace que la burbuja APUNTE a quien la escribió, sin necesidad de un avatar del
                  lado del vet — que es lo que deja el hilo con un solo avatar y sin simetría falsa. */}
              <div className="max-w-[80%] break-words whitespace-pre-wrap rounded-[14px] rounded-br-[4px] bg-surface-2 px-3.5 py-2.5 text-[13.5px] leading-normal">
                {msg.parts
                  .filter((p): p is Extract<(typeof msg.parts)[number], { type: "text" }> => p.type === "text")
                  .map((p) => p.text)
                  .join("")
                  // El contenido extraído del documento SÍ viajó (el modelo lo necesita), pero en la
                  // burbuja se colapsa a su nombre: quince mil caracteres de CSV no son conversación.
                  .replace(/\[Documento adjunto: ([^\]]+)\]\n"""\n[\s\S]*?\n"""/g, "Adjunto: $1")}
              </div>
            </div>
          ) : (
            <AssistantMessage
              key={msg.id}
              message={msg}
              streaming={status === "streaming" && msg.id === lastMessage?.id}
              onOpcion={msg.id === lastMessage?.id && !busy ? enviarOpcion : undefined}
            />
          ),
        )}

        {/* Con el MISMO avatar que las respuestas: así el turno que está por llegar ocupa el lugar
            que va a ocupar, y el hilo no salta cuando llega el primer token. La espera es VIVA
            (puntos que laten + frase que evoluciona): un indicador estático de 40 segundos se lee
            como un bug — ver components/athos/pensando.tsx. */}
        {status === "submitted" && (
          <div className="flex items-center gap-[11px]">
            <span
              aria-hidden
              className="grid size-[26px] shrink-0 place-items-center rounded-[8px] bg-brand-soft text-brand-text"
            >
              <BrandGlyph className="size-3.5" fill="currentColor" />
            </span>
            <Pensando />
          </div>
        )}

        {/* El fallo, EN EL HILO y con salida. Antes era una línea de 12 px + un toast que se
            esfuma: David escribió, esperó 1:30 y vio una burbuja en blanco (25-ago, 4 preguntas
            sin respuesta en 2 días). Un fallo que no se ve es indistinguible de la app colgada, y
            un fallo sin botón obliga a re-teclear la pregunta. `regenerate` reintenta el último
            turno tal cual — la pregunta no se pierde. */}
        {error && (
          <div className="flex flex-col gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">
              La respuesta no llegó: {error.message}
            </p>
            <div>
              <Button size="sm" variant="outline" onClick={() => regenerate()}>
                Reintentar
              </Button>
            </div>
          </div>
        )}

        {/* Lo que quedó esperando aprobación, leído de athos_actions. Las tarjetas del streaming
            se pierden al recargar (solo se persiste el texto del turno); esto no. */}
        <PendingActions recargarToken={messages.length} excluir={idsEnHilo} />
      </div>

      {/* Compositor. Franja separada por una línea, como en el mockup: la conversación termina y
          acá empieza la entrada. Antes era una card con sombra flotando sobre otra card. */}
      {/* CON MENSAJES el compositor va al pie, separado por una línea. En vacío no se pinta acá:
          ya está en el medio, dentro del hero. */}
      {!vacio && (
      // `shrink-0`: el contenedor de arriba lleva `overflow-hidden`, así que lo que se salga se
      // CORTA sin barra que lo alcance. El hilo tiene `flex-basis: 0` y ya no puede ceder más, o sea
      // que en una ventana baja el único que quedaba para absorber el faltante era este compositor —
      // y se cortaba contra el borde con el botón de enviar adentro. El hilo tiene su propio scroll;
      // el compositor no puede desaparecer, porque es la única forma de salir de esta pantalla.
      <div className="-mx-4 mt-auto shrink-0 border-t border-line px-4 pt-4 md:-mx-6 md:px-6">
       <div className="mx-auto w-full max-w-[780px]">
        {compositor}
        {/* LA ADVERTENCIA APARECE AL ESCRIBIR, no al cargar la pantalla.
            Un aviso permanente de "esto es de pago" convierte la pantalla entera en un cartel y se
            deja de leer a los dos días. Enganchado a que haya texto, aparece en el único momento en
            que sirve: cuando el vet está por mandar algo y conviene que sepa qué va a pasar antes
            de apretar Enter, en vez de descubrirlo con una ventana en la cara.

            Ocupa el lugar de la nota de "VetGPT propone — tú apruebas" en vez de sumarse: dos líneas
            de letra chica bajo el compositor no las lee nadie, y con el plan en free la que importa
            es ésta. */}
        {!puedeUsarAthos && input.trim() ? (
          <p className="mt-2 flex items-center gap-1.5 text-[11px] text-brand-text">
            <Sparkles className="size-3 shrink-0" aria-hidden />
            VetGPT es parte del plan Pro. Al enviar te vamos a mostrar cómo activarlo.
          </p>
        ) : (
          <p className="mt-2 text-[11px] text-fg-faint">
            VetGPT propone — tú apruebas. Ninguna acción se ejecuta sin tu confirmación.
          </p>
        )}
       </div>
      </div>
      )}
      {ventana}
    </div>
  )
}
