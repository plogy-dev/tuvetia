// La consulta que se está grabando — viva fuera del árbol de React.
//
// POR QUÉ ESTO NO ES UN COMPONENTE. Hasta hoy el micrófono vivía en `consultation-recorder.tsx`,
// con un `useEffect` de limpieza que soltaba el stream y cerraba el WebSocket al desmontar. O sea
// que irse a la agenda a mirar la próxima cita MATABA la grabación en curso, en silencio y a mitad
// de una consulta clínica.
//
// Sacarlo a un módulo tiene tres razones concretas, ninguna estética:
//
//   1. Un layout de segmento no se re-monta en navegación cliente, pero un componente de página sí.
//      Lo que no puede morir no puede vivir en el árbol de la ruta.
//   2. En dev, Strict Mode monta-desmonta-monta. Con el micrófono en un `useEffect`, ese desmontaje
//      intermedio suelta el stream: el mismo bug, reproducido en cada recarga del dev server.
//   3. `vitest.config.mts` corre en `environment: "node"` y sólo incluye `src/**/*.test.ts`: no hay
//      infraestructura para testear componentes. Lo que quiera cobertura tiene que ser un `.ts`.
//
// React sólo OBSERVA, con `useSyncExternalStore`. Por eso `leer()` devuelve un snapshot cacheado:
// si devolviera un objeto nuevo en cada llamada, React entra en bucle con
// "The result of getSnapshot should be cached".
//
// LO QUE NO CAMBIA: el consentimiento sigue siendo previo y bloqueante. `iniciar()` se llama DESPUÉS
// de que la fila de `consents` está insertada, exactamente en el orden de antes, y el trigger de la
// base sigue siendo la barrera real.

import { toast } from "sonner"

import { athosTranscribe } from "@/lib/athos"
import { LiveTranscription } from "@/lib/athos-live"
import { createClient } from "@/lib/supabase/client"

const AUDIO_BUCKET = "consultation-audios"

/**
 * Tope duro. La persistencia crea un modo de fallo que antes era imposible: si navegar ya no
 * detiene la grabación, OLVIDARSE de detenerla pasa a ser lo más probable que puede salir mal — y
 * un micrófono abierto toda la tarde es audio de terceros que nadie consintió, más la factura de
 * transcripción. A los 90 minutos se corta sola y se sube lo capturado.
 */
const TOPE_SEGUNDOS = 90 * 60
/** Aviso antes del corte, para que el vet pueda cerrarla él. */
const AVISO_SEGUNDOS = 45 * 60

/** Migaja para detectar que la pestaña se recargó con una grabación viva. */
const MIGAJA = "tuvetia:consulta-viva"

export type FaseGrabacion =
  | "inactiva"
  | "grabando"
  | "subiendo"
  | "transcribiendo"
  | "terminada"
  /** El micrófono se cayó solo: permiso revocado, o se desconectó el dispositivo. */
  | "perdida"

export type EstadoConsultaViva = {
  fase: FaseGrabacion
  consultaId: string | null
  pacienteNombre: string | null
  segundos: number
  /** Texto confirmado por el proveedor de transcripción. */
  estable: string
  /** Hipótesis que el proveedor todavía puede reemplazar. */
  provisional: string
  /** ¿La transcripción en vivo sigue en pie? Si no, se transcribe por lotes al cerrar. */
  vivo: boolean
  error: string | null
}

const INACTIVA: EstadoConsultaViva = {
  fase: "inactiva",
  consultaId: null,
  pacienteNombre: null,
  segundos: 0,
  estable: "",
  provisional: "",
  vivo: false,
  error: null,
}

type Parametros = {
  consultaId: string
  clinicId: string
  pacienteNombre?: string | null
  /** Se llama cuando la transcripción quedó guardada. Puede correr con el vet en otra pantalla. */
  alTranscribir?: () => void
}

// ── Estado privado del módulo ───────────────────────────────────────────────────────────────────
let snapshot: EstadoConsultaViva = INACTIVA
const oyentes = new Set<() => void>()

let grabador: MediaRecorder | null = null
let stream: MediaStream | null = null
let vivoRef: LiveTranscription | null = null
let cronometro: ReturnType<typeof setInterval> | null = null
let trozos: Blob[] = []
let params: Parametros | null = null

function emitir(cambios: Partial<EstadoConsultaViva>): void {
  snapshot = { ...snapshot, ...cambios }
  for (const fn of oyentes) fn()
}

// ── El aviso del navegador al cerrar o recargar ─────────────────────────────────────────────────
//
// Es la ÚNICA defensa real contra perder el audio: cubre recargar, cerrar la pestaña y el botón
// atrás. Se engancha sólo mientras se graba — un `beforeunload` permanente molesta el resto del
// tiempo y termina ignorándose.
function avisarAlSalir(e: BeforeUnloadEvent): void {
  e.preventDefault()
}

function engancharSalida(): void {
  if (typeof window === "undefined") return
  window.addEventListener("beforeunload", avisarAlSalir)
}

function desengancharSalida(): void {
  if (typeof window === "undefined") return
  window.removeEventListener("beforeunload", avisarAlSalir)
}

/**
 * Deja constancia de que hay una grabación viva, para poder detectar una recarga.
 *
 * `sessionStorage` y no `localStorage` a propósito: sobrevive al reload de la MISMA pestaña —que es
 * justo el caso a detectar— y muere al cerrarla, donde ya no hay a quién avisarle.
 */
function dejarMigaja(consultaId: string, pacienteNombre: string | null): void {
  try {
    sessionStorage.setItem(MIGAJA, JSON.stringify({ consultaId, pacienteNombre }))
  } catch {
    // Modo incógnito o storage lleno: la migaja es un extra, no puede tumbar la grabación.
  }
}

function borrarMigaja(): void {
  try {
    sessionStorage.removeItem(MIGAJA)
  } catch {
    /* ídem */
  }
}

/**
 * ¿Se recargó la página con una grabación en curso? Devuelve la migaja y la consume.
 *
 * NO recupera nada, y no se puede: `MediaRecorder` y los blobs mueren con el documento, y
 * `getUserMedia` no se puede re-adquirir sin un gesto del usuario. Lo que hace es convertir una
 * pérdida SILENCIOSA en una pérdida declarada, que es lo único honesto disponible.
 */
export function migajaDeGrabacionPerdida(): { consultaId: string; pacienteNombre: string | null } | null {
  try {
    const crudo = sessionStorage.getItem(MIGAJA)
    if (!crudo) return null
    sessionStorage.removeItem(MIGAJA)
    return JSON.parse(crudo) as { consultaId: string; pacienteNombre: string | null }
  } catch {
    return null
  }
}

function limpiarRecursos(): void {
  if (cronometro) clearInterval(cronometro)
  cronometro = null
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  grabador = null
  desengancharSalida()
  borrarMigaja()
}

// ── La API pública ──────────────────────────────────────────────────────────────────────────────
export const consultaViva = {
  suscribir(fn: () => void): () => void {
    oyentes.add(fn)
    return () => {
      oyentes.delete(fn)
    }
  },

  /** Snapshot CACHEADO: la misma referencia hasta que algo cambie. Lo exige useSyncExternalStore. */
  leer(): EstadoConsultaViva {
    return snapshot
  },

  /** Para el servidor: nunca hay grabación durante el render del servidor. */
  leerEnServidor(): EstadoConsultaViva {
    return INACTIVA
  },

  estaGrabando(): boolean {
    return snapshot.fase === "grabando"
  },

  async iniciar(p: Parametros): Promise<void> {
    // CERROJO DE SESIÓN ÚNICA. Antes esto era imposible por accidente: navegar cortaba la grabación,
    // así que no podía haber dos. La persistencia lo habilita, y hay que taparlo en el mismo cambio
    // — dos micrófonos abiertos mezclarían dos consultas en el mismo audio.
    if (snapshot.fase === "grabando" || snapshot.fase === "subiendo" || snapshot.fase === "transcribiendo") {
      const quien = snapshot.pacienteNombre ? ` de ${snapshot.pacienteNombre}` : ""
      throw new Error(`Ya estás grabando la consulta${quien}. Detenela antes de iniciar otra.`)
    }

    // `getUserMedia` exige un gesto del usuario. Sigue habiéndolo: esto se llama desde el onClick
    // del botón, en la misma cadena de tarea. Lo que lo rompería es arrancar sin click.
    const media = await navigator.mediaDevices.getUserMedia({ audio: true })

    // TODO SE ARMA ANTES DE ANUNCIAR "grabando".
    //
    // La primera versión marcaba la fase apenas conseguía el micrófono y construía el resto después.
    // Los tests de este archivo destaparon lo que eso significa: `new MediaRecorder(media, {mimeType:
    // "audio/webm"})` LANZA donde ese contenedor no está soportado —Safari, o sea todo iPhone—, y ahí
    // la sesión quedaba clavada en "grabando" para siempre: micrófono abierto, cronómetro que nunca
    // arrancó, pastilla mintiendo, y el cerrojo de sesión única impidiendo iniciar otra consulta
    // nunca más. Sólo se salía recargando.
    //
    // Con el orden invertido, un fallo en cualquier punto deja la sesión intacta en `inactiva` y lo
    // único que hay que deshacer es soltar el micrófono.
    try {
      // La sesión en vivo NUNCA lanza: si no se pudo abrir, `activa` queda en false y todo sigue por
      // el camino de lotes al cerrar, igual que antes de que existiera.
      const live = await LiveTranscription.open(
        { consultationId: p.consultaId, clinicId: p.clinicId },
        {
          onText: (est, prov) => emitir({ estable: est, provisional: prov }),
          onFallback: (motivo) => {
            emitir({ vivo: false })
            console.info(`[fantasma] transcripción en vivo no disponible: ${motivo}`)
          },
        },
      )

      const rec = new MediaRecorder(media, { mimeType: "audio/webm", audioBitsPerSecond: 48000 })
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) {
          trozos.push(e.data)
          // El MISMO trozo va al bucket (acumulado) y al vivo. No se transforma: sólo el primero
          // lleva la cabecera del contenedor webm, y sin ella no decodifica.
          void vivoRef?.enviarAudio(e.data)
        }
      }
      rec.start(1000)

      vivoRef = live
      grabador = rec
      stream = media
      trozos = []
      params = p

      emitir({
        fase: "grabando",
        consultaId: p.consultaId,
        pacienteNombre: p.pacienteNombre ?? null,
        segundos: 0,
        estable: "",
        provisional: "",
        vivo: live.activa,
        error: null,
      })
    } catch (e) {
      // Soltar el micrófono es lo único imprescindible: si esto no corre, el navegador se queda con
      // el indicador de grabación encendido y nada lo apaga salvo cerrar la pestaña.
      media.getTracks().forEach((t) => t.stop())
      vivoRef?.cerrar()
      vivoRef = null
      throw new Error(`No se pudo iniciar la grabación: ${(e as Error).message}`)
    }

    // El micrófono se puede caer solo: permiso revocado desde la barra del navegador, o un auricular
    // USB desconectado. Antes no estaba manejado en absoluto — la grabación seguía "activa" sin
    // capturar nada. Ahora se cierra lo que haya con la fase `perdida`.
    for (const track of media.getAudioTracks()) {
      track.onended = () => {
        if (snapshot.fase !== "grabando") return
        emitir({ error: "Se perdió el micrófono. Se guarda lo que se alcanzó a grabar." })
        void consultaViva.detener("perdida")
      }
    }

    engancharSalida()
    dejarMigaja(p.consultaId, p.pacienteNombre ?? null)

    cronometro = setInterval(() => {
      const s = snapshot.segundos + 1
      emitir({ segundos: s })
      if (s === AVISO_SEGUNDOS) {
        toast.warning("Llevás 45 minutos grabando. Si la consulta terminó, detené la grabación.")
      }
      if (s >= TOPE_SEGUNDOS) {
        toast.warning("La grabación se detuvo a los 90 minutos. Se guarda todo lo capturado.")
        void consultaViva.detener()
      }
    }, 1000)
  },

  /**
   * Cierra la grabación: corta el vivo, sube el audio y deja la transcripción guardada.
   *
   * Nunca lanza: quien la llama suele ser un botón o el propio cronómetro, y un fallo acá no puede
   * dejar el micrófono abierto. El error viaja en el estado.
   */
  async detener(motivo: "normal" | "perdida" = "normal"): Promise<void> {
    if (snapshot.fase !== "grabando") return
    const p = params
    if (!p) return

    // Se cortan micrófono y cronómetro ANTES de nada: pase lo que pase después, el micrófono ya no
    // está abierto.
    if (cronometro) clearInterval(cronometro)
    cronometro = null
    grabador?.stop()
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    grabador = null
    desengancharSalida()
    borrarMigaja()

    const duracion = snapshot.segundos
    emitir({ fase: "subiendo" })

    const live = vivoRef
    try {
      // Se le corta la entrada al proveedor y se esperan sus últimos tramos ANTES de subir: el final
      // de la consulta es donde está el plan, y perderlo sería lo peor.
      await live?.detener()

      const blob = new Blob(trozos, { type: "audio/webm" })
      const supabase = createClient()
      const audioId = crypto.randomUUID()
      // La ruta empieza por clinic_id: es lo que usan las policies de Storage para aislar.
      const path = `${p.clinicId}/${p.consultaId}/${audioId}.webm`

      const { error: upErr } = await supabase.storage
        .from(AUDIO_BUCKET)
        .upload(path, blob, { contentType: "audio/webm", upsert: false })
      if (upErr) throw new Error(`subida del audio: ${upErr.message}`)

      const { error: rowErr } = await supabase.from("consultation_audios").insert({
        id: audioId,
        clinic_id: p.clinicId,
        consultation_id: p.consultaId,
        storage_path: path,
        duration_secs: duracion,
        file_size: blob.size,
        encoding: "audio/webm;codecs=opus",
      })
      if (rowErr) throw new Error(`registro del audio: ${rowErr.message}`)

      emitir({ fase: "transcribiendo" })
      // Recién ahora existe la fila del audio, que es lo que exige la FK de `transcripts.audio_id`.
      const guardado = await live?.finalizar(audioId)
      if (!guardado) await athosTranscribe({ consultationId: p.consultaId, clinicId: p.clinicId })

      live?.cerrar()
      emitir({ fase: "terminada" })
      // El vet puede estar en otra pantalla: por eso el aviso sale del módulo y no del componente.
      toast.success(
        motivo === "perdida"
          ? "Se guardó lo que se alcanzó a grabar. Ya podés generar la nota."
          : "Consulta transcrita. Ya podés generar la nota.",
      )
      p.alTranscribir?.()
    } catch (e) {
      live?.cerrar()
      const msg = (e as Error).message
      emitir({ fase: "perdida", error: msg })
      toast.error(`No se pudo procesar la grabación: ${msg}`)
    } finally {
      vivoRef = null
      trozos = []
      params = null
    }
  },

  /** Vuelve a inactiva tras una sesión terminada o fallida, para poder grabar otra. */
  reiniciar(): void {
    if (snapshot.fase === "grabando" || snapshot.fase === "subiendo" || snapshot.fase === "transcribiendo") {
      return
    }
    limpiarRecursos()
    snapshot = INACTIVA
    for (const fn of oyentes) fn()
  },
}
