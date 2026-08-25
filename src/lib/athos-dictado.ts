// Dictado por micrófono para el chat de Athos (reunión 24-ago: "metamos un dictado para esa
// vaina… no necesitamos nada muy evolucionado, simplemente que tome la voz").
//
// POR QUÉ Web Speech API y no Deepgram: el WS en vivo de athos-service exige un
// `consultation_id` real (persiste transcripts con FK) — el chat no tiene consulta. Y el dictado
// de un compositor no es una transcripción clínica: es rellenar un input. La API del navegador lo
// hace gratis, sin red y sin tokens; si el navegador no la trae, el botón NO SE PINTA (mejor
// ausente que roto). El día que haga falta calidad Deepgram, el camino es un endpoint de dictado
// sin consulta en athos-service — está anotado, no improvisado.
import { useEffect, useRef, useState, useSyncExternalStore } from "react"

// TS no trae tipos para la Web Speech API (vive con prefijo webkit). Mínimo necesario, sin `any`.
type EventoResultado = {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } } & ArrayLike<{ transcript: string }>>
}
type Reconocedor = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: EventoResultado) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error?: string }) => void) | null
  start: () => void
  stop: () => void
}
type CtorReconocedor = new () => Reconocedor

function obtenerCtor(): CtorReconocedor | null {
  if (typeof window === "undefined") return null
  const w = window as unknown as {
    SpeechRecognition?: CtorReconocedor
    webkitSpeechRecognition?: CtorReconocedor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export type TextoDictado = {
  /** Lo ya confirmado por el reconocedor en esta sesión de dictado. */
  estable: string
  /** La hipótesis en curso (cambia mientras se habla; puede quedar vacía). */
  provisional: string
}

/**
 * Hook de dictado: `soportado` decide si el botón existe; `activo` su estado; `alternar()` lo
 * prende y apaga. `onTexto` recibe el acumulado de la sesión en cada avance — el llamador decide
 * cómo mezclarlo con lo que ya había escrito.
 */
const _sinSuscripcion = () => () => {}

export function useDictado(onTexto: (t: TextoDictado) => void) {
  // `soportado` con useSyncExternalStore y snapshot de servidor en false: el server no tiene
  // window, y un setState síncrono dentro de un efecto lo prohíbe la regla
  // react-hooks/set-state-in-effect del repo. El soporte del navegador no cambia en vivo,
  // así que la "suscripción" es un no-op.
  const soportado = useSyncExternalStore(
    _sinSuscripcion,
    () => obtenerCtor() !== null,
    () => false,
  )
  const [activo, setActivo] = useState(false)
  const recRef = useRef<Reconocedor | null>(null)
  const onTextoRef = useRef(onTexto)

  // El "latest ref" se actualiza en efecto (escribir refs durante el render lo prohíbe la regla
  // react-hooks/refs): así una sesión de dictado larga siempre habla con el onTexto vigente.
  useEffect(() => {
    onTextoRef.current = onTexto
  }, [onTexto])

  useEffect(() => {
    return () => recRef.current?.stop() // desmontar con el mic abierto lo cierra
  }, [])

  function alternar() {
    if (activo) {
      recRef.current?.stop() // onend se encarga del estado
      return
    }
    const Ctor = obtenerCtor()
    if (!Ctor) return
    const rec = new Ctor()
    rec.lang = "es-CO"
    rec.continuous = true
    rec.interimResults = true
    let finales = ""
    rec.onresult = (e) => {
      let provisional = ""
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) finales += r[0].transcript
        else provisional += r[0].transcript
      }
      onTextoRef.current({ estable: finales, provisional })
    }
    rec.onend = () => {
      setActivo(false)
      recRef.current = null
    }
    rec.onerror = () => {
      // `no-speech` y compañía terminan la sesión sola vía onend; no hay nada que reportar que el
      // vet pueda accionar — el texto que alcanzó a dictar queda en el input.
    }
    recRef.current = rec
    rec.start()
    setActivo(true)
  }

  return { soportado, activo, alternar }
}
