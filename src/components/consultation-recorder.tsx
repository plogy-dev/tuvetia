"use client"

// Modo Fantasma — la vista de la captura.
// Flujo: consentimiento (Ley 1581, BLOQUEANTE) -> grabar -> subir al bucket privado
// -> registrar consultation_audios -> pedir transcripción -> avisar al padre.
// Sin consentimiento no se habilita el micrófono; además la BD lo bloquea por trigger.
//
// LA GRABACIÓN YA NO VIVE ACÁ. Vive en `lib/consulta-viva/sesion.ts`, un módulo singleton, y este
// componente sólo la MIRA. El motivo es concreto: antes había un `useEffect` de limpieza que soltaba
// el micrófono al desmontar, así que irse a la agenda a mirar la próxima cita mataba la grabación en
// curso, en silencio y a mitad de una consulta.
//
// Consecuencia buena y no obvia: volver a esta pantalla RE-ENGANCHA la misma sesión y muestra el
// mismo texto en vivo, porque el texto vive en el módulo y no en el estado de este componente.
//
// El consentimiento SE QUEDA acá y no se mueve a la pastilla flotante: tiene que estar en la
// pantalla, donde el titular puede leerlo en el monitor del vet. Pedirlo desde una burbuja es peor
// evidencia legal, no mejor.

import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLines, Loader2, Mic, ShieldCheck, Square } from "lucide-react"
import { toast } from "sonner"

import { comoReloj } from "@/lib/duracion"
import { consultaViva } from "@/lib/consulta-viva/sesion"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import { createClient } from "@/lib/supabase/client"
import { HelpTip } from "@/components/help-tip"
import { Button } from "@/components/ui/button"

// Versión del texto mostrado al titular. Si cambia el texto, sube la versión:
// queda registrada en consents.text_version como evidencia de QUÉ se aceptó.
const CONSENT_TEXT_VERSION = "v1-2026-07"
const CONSENT_SCOPE = ["audio_recording", "transcription", "clinical_note"]

export function ConsultationRecorder({
  consultationId,
  clinicId,
  patientId,
  ownerId,
  patientName,
  motivo,
  onTranscribed,
}: {
  consultationId: string
  clinicId: string
  patientId: string
  ownerId?: string | null
  patientName?: string
  /** `consultations.chief_complaint`, para que el panel lo muestre mientras se graba. */
  motivo?: string | null
  onTranscribed?: () => void
}) {
  const [supabase] = useState(() => createClient())
  const [pidiendoConsentimiento, setPidiendoConsentimiento] = useState(false)
  const sesion = useConsultaViva()

  // La sesión es global: puede haber una grabación de OTRA consulta. Esta pantalla sólo muestra el
  // estado de la suya — si no, el vet vería el transcript de otro paciente en esta ficha.
  const esLaMia = sesion.consultaId === consultationId
  const grabando = esLaMia && sesion.fase === "grabando"
  const cerrando = esLaMia && (sesion.fase === "subiendo" || sesion.fase === "transcribiendo")
  const lista = esLaMia && sesion.fase === "terminada"
  const otraEnCurso = !esLaMia && sesion.fase === "grabando"

  const mmss = comoReloj(sesion.segundos)

  // Inserta la fila de consentimiento de ESTA consulta (el trigger de BD la exige siempre).
  // owner_scope=true cuando el titular acepta por primera vez -> cubre sus próximas consultas.
  const insertConsent = useCallback(
    async (ownerScope: boolean) => {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error("Sesión no válida")
      const { error } = await supabase.from("consents").insert({
        clinic_id: clinicId,
        consultation_id: consultationId,
        patient_id: patientId,
        obtained_by: user.id,
        text_version: CONSENT_TEXT_VERSION,
        scope: CONSENT_SCOPE,
        owner_scope: ownerScope,
      })
      if (error) throw new Error(error.message)
    },
    [supabase, clinicId, consultationId, patientId],
  )

  // El micrófono se abre SIEMPRE después de que el consentimiento quedó registrado, igual que antes.
  const grabar = useCallback(async () => {
    try {
      await consultaViva.iniciar({
        consultaId: consultationId,
        clinicId,
        // Con el paciente en la sesión, Athos puede leer su ficha mientras la consulta pasa: es lo
        // que gobierna el guard de dosis y el aviso de alergias severas en las sugerencias en vivo.
        pacienteId: patientId,
        pacienteNombre: patientName ?? null,
        motivo: motivo ?? null,
        alTranscribir: onTranscribed,
      })
      setPidiendoConsentimiento(false)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }, [consultationId, clinicId, patientId, patientName, motivo, onTranscribed])

  // Arranque: si el titular YA dio su consentimiento (vigente, no revocado), no se re-pregunta —
  // se registra la fila de esta consulta citando ese consentimiento y se graba directo.
  const iniciar = useCallback(async () => {
    if (ownerId) {
      const { data: standing } = await supabase.rpc("has_owner_consent", { p_owner_id: ownerId })
      if (standing === true) {
        try {
          await insertConsent(false)
        } catch (e) {
          toast.error(`No se pudo registrar el consentimiento: ${(e as Error).message}`)
          return
        }
        toast.success("Consentimiento vigente del titular — grabando")
        await grabar()
        return
      }
    }
    setPidiendoConsentimiento(true)
  }, [ownerId, supabase, insertConsent, grabar])

  // ARRANQUE AUTOMÁTICO al llegar desde "Iniciar consulta".
  //
  // Se dispara una sola vez y sólo con `?grabar=1` en la URL, que pone el drawer al crear la
  // consulta. Llama al MISMO `iniciar()` que el botón: si hay consentimiento vigente graba, y si no
  // lo hay abre el panel para que el titular lo lea. El gate no se mueve.
  //
  // El permiso del micrófono lo pide `getUserMedia` dentro de `iniciar()`. Viene de un gesto real
  // del vet —el clic en "Iniciar consulta"— aunque haya ocurrido en la pantalla anterior.
  // El arranque se DIFIERE un tick en vez de llamarse en el cuerpo del efecto. `iniciar()` puede
  // hacer `setState` de forma síncrona —cuando no hay `ownerId` abre el panel de consentimiento
  // directo— y eso encadena renders. Con el `setTimeout` la acción ocurre después del montaje, que
  // es cuando de verdad corresponde, y la limpieza la cancela si el componente se fue antes.
  const yaArranco = useRef(false)
  useEffect(() => {
    if (yaArranco.current) return
    if (typeof window === "undefined") return
    if (new URLSearchParams(window.location.search).get("grabar") !== "1") return
    yaArranco.current = true
    const t = setTimeout(() => void iniciar(), 0)
    return () => clearTimeout(t)
  }, [iniciar])

  const aceptarConsentimiento = useCallback(async () => {
    try {
      await insertConsent(true)
    } catch (e) {
      toast.error(`No se pudo registrar el consentimiento: ${(e as Error).message}`)
      return
    }
    await grabar()
  }, [insertConsent, grabar])

  // ---------- UI ----------
  if (pidiendoConsentimiento) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="size-4 text-muted-foreground" /> Consentimiento del titular
        </div>
        <p className="mb-3 text-sm text-muted-foreground">
          Vamos a grabar el audio de esta consulta{patientName ? ` de ${patientName}` : ""} para
          transcribirla y redactar la nota clínica. El audio se conserva 4 días y luego se elimina;
          la transcripción queda en la historia. La autorización del titular <b>cubre también las
          próximas consultas de sus mascotas</b> (no se le volverá a preguntar) y puede revocarla en
          cualquier momento (Ley 1581 de 2012).
        </p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={aceptarConsentimiento}>
            <Mic className="size-4" /> El titular autoriza — empezar a grabar
          </Button>
          <Button variant="outline" onClick={() => setPidiendoConsentimiento(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  if (grabando) {
    return (
      <div className="rounded-xl border border-destructive/40 bg-danger-soft p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="size-2 rounded-full bg-destructive motion-safe:animate-pulse" />
            <span className="font-medium">Grabando consulta</span>
            <span className="font-mono text-muted-foreground">{mmss}</span>
            {sesion.vivo && (
              <span className="text-xs text-muted-foreground">· transcribiendo en vivo</span>
            )}
          </div>
          <Button variant="destructive" onClick={() => void consultaViva.detener()}>
            <Square className="size-4" /> Detener y transcribir
          </Button>
        </div>

        {/* Que esto siga acá al volver de otra pantalla es la prueba de que la sesión sobrevivió:
            el texto vive en el módulo, no en este componente. */}
        {(sesion.estable || sesion.provisional) && (
          <div
            className="mt-3 max-h-48 overflow-y-auto rounded-lg border bg-background p-3 text-sm leading-relaxed"
            aria-live="polite"
            aria-label="Transcripción en vivo"
          >
            {sesion.estable.split("\n").map((linea, i) => {
              const [quien, ...resto] = linea.split(":")
              const dicho = resto.join(":").trim()
              if (!dicho) return null
              return (
                <p key={i} className="mb-1">
                  <span className="font-medium text-muted-foreground">{quien}:</span> {dicho}
                </p>
              )
            })}
            {/* La hipótesis en curso va atenuada: el proveedor la reemplaza al confirmar. */}
            {sesion.provisional && (
              <p className="text-muted-foreground/60 italic">{sesion.provisional}</p>
            )}
          </div>
        )}
      </div>
    )
  }

  if (cerrando) {
    return (
      <div className="flex items-center gap-2 rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {sesion.fase === "subiendo" ? "Guardando el audio…" : "Transcribiendo la consulta…"}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-sm">
        <AudioLines className="size-4 text-muted-foreground" />
        <span>
          {lista
            ? "Consulta grabada y transcrita."
            : otraEnCurso
              ? `Hay otra consulta grabando${sesion.pacienteNombre ? ` (${sesion.pacienteNombre})` : ""}. Detenela antes de empezar ésta.`
              : "Graba la consulta para que Athos redacte la nota."}
        </span>
        <HelpTip>
          Antes de grabar se pide el <b>consentimiento del titular</b> (Ley 1581). El audio se
          transcribe y Athos redacta la nota SOAP; el audio se elimina a los 4 días.
        </HelpTip>
      </div>
      <Button onClick={iniciar} disabled={otraEnCurso} variant={lista ? "outline" : "default"}>
        <Mic className="size-4" /> {lista ? "Grabar otra vez" : "Iniciar grabación"}
      </Button>
    </div>
  )
}
