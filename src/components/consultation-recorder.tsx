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
// Consecuencia buena y no obvia: volver a esta pantalla RE-ENGANCHA la misma sesión —el estado
// vive en el módulo, no en este componente— y la consulta reaparece en el Cockpit, con su
// cronómetro y su texto intactos.
//
// El consentimiento SE QUEDA acá y no se mueve a la pastilla flotante: tiene que estar en la
// pantalla, donde el titular puede leerlo en el monitor del vet. Pedirlo desde una burbuja es peor
// evidencia legal, no mejor.

import { useCallback, useEffect, useRef, useState } from "react"
import { AudioLines, Mic, ShieldCheck } from "lucide-react"
import { toast } from "sonner"

import { consultaViva } from "@/lib/consulta-viva/sesion"
import { useConsultaViva } from "@/lib/consulta-viva/usar"
import { createClient } from "@/lib/supabase/client"
import { HelpTip } from "@/components/help-tip"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

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
  const lista = esLaMia && sesion.fase === "terminada"
  const otraEnCurso = !esLaMia && sesion.fase === "grabando"

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
        // Con el paciente en la sesión, VetGPT puede leer su ficha mientras la consulta pasa: es lo
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
  // Se dispara sólo con `?grabar=1` en la URL, que pone el drawer al crear la consulta. Llama al
  // MISMO `iniciar()` que el botón: si hay consentimiento vigente graba, y si no lo hay abre el
  // panel para que el titular lo lea. El gate no se mueve.
  //
  // ── EL PARÁMETRO SE CONSUME, NO SE LEE ──────────────────────────────────────────────────────
  //
  // Acá estaba el defecto que David reportó el 26-ago como «uno deja de grabar y sale una vaina
  // abajo a la derecha que confunde al usuario y como que traba el app».
  //
  // Mientras se graba, la pantalla de la consulta devuelve el Cockpit y ESTE COMPONENTE SE
  // DESMONTA. Al acabar vuelve a montarse —instancia nueva, `yaArranco` otra vez en falso— y el
  // `?grabar=1` seguía intacto en la URL. Así que el efecto arrancaba de nuevo, sobre una consulta
  // recién terminada:
  //
  //   · insertaba una SEGUNDA fila en `consents` — evidencia legal duplicada (Ley 1581), que es
  //     lo más grave de todo esto y no se veía en pantalla;
  //   · chocaba con el cerrojo de sesión única y disparaba «Ya estás grabando la consulta de X.
  //     Detenela antes de iniciar otra» — el mensaje sin sentido que él vio;
  //   · y sin `ownerId`, peor todavía: abría el modal de consentimiento ENCIMA de la nota recién
  //     transcrita, con su backdrop y su trampa de foco. Eso es el «traba el app», literal.
  //
  // Un `useRef` no podía cerrar esto: el ref muere con la instancia y el problema ES que hay
  // instancia nueva. Lo que tiene que morir es la orden, así que se borra de la URL apenas se
  // ejecuta. Con `history.replaceState` y no con el router: es la misma ruta, no hay nada que
  // navegar, y un `router.replace` volvería a renderizar el árbol justo en el peor momento.
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
    const url = new URL(window.location.href)
    if (url.searchParams.get("grabar") !== "1") return
    yaArranco.current = true
    url.searchParams.delete("grabar")
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`)
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
  // EL CONSENTIMIENTO ES UN DIÁLOGO CENTRADO, no una tarjeta en el flujo de la página (David,
  // 26-ago: «falta que salga el pop up de alerta de que el cliente autoriza»). La tarjeta inline
  // existía y cumplía, pero vivía donde la pantalla la dejara caer: llegando desde «Iniciar
  // consulta» con la página a medio cargar, quedaba fuera de la vista y el vet creía que el gate
  // no estaba. Un modal no depende de dónde esté el scroll — y sigue siendo la pantalla del vet,
  // que el titular puede leer en su monitor: el argumento legal de no pedirlo desde la burbuja
  // flotante se mantiene intacto. El TEXTO no cambia, así que CONSENT_TEXT_VERSION tampoco.
  const dialogoDeConsentimiento = (
    <Dialog open={pidiendoConsentimiento} onOpenChange={(v) => !v && setPidiendoConsentimiento(false)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-brand-soft">
            <ShieldCheck className="size-5 text-brand-text" aria-hidden />
          </div>
          <DialogTitle>Consentimiento del titular</DialogTitle>
          <DialogDescription>
            Vamos a grabar el audio de esta consulta{patientName ? ` de ${patientName}` : ""} para
            transcribirla y redactar la nota clínica. El audio se conserva 4 días y luego se
            elimina; la transcripción queda en la historia. La autorización del titular{" "}
            <b>cubre también las próximas consultas de sus mascotas</b> (no se le volverá a
            preguntar) y puede revocarla en cualquier momento (Ley 1581 de 2012).
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPidiendoConsentimiento(false)}>
            Cancelar
          </Button>
          <Button onClick={aceptarConsentimiento}>
            <Mic className="size-4" /> El titular autoriza — empezar a grabar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )

  // ── ACÁ NO SE GRABA NI SE MUESTRA LA GRABACIÓN EN CURSO ─────────────────────────────────────
  //
  // Había dos ramas más —«Grabando consulta» con su transcripción en vivo, y «Guardando el
  // audio…»— y las dos eran INALCANZABLES. La pantalla de la consulta devuelve el Cockpit mientras
  // la sesión de ESTA consulta está viva (`page.tsx`: grabando, subiendo o transcribiendo), así que
  // este componente ni siquiera está montado en esos estados. Su condición era la misma que la del
  // Cockpit, palabra por palabra, y perdía siempre.
  //
  // Costaba entender el módulo —parecían dos superficies de grabación compitiendo— y hacía creer
  // que la transcripción en vivo tenía un lugar donde mostrarse que en realidad nunca se pintaba.
  // La grabación en curso se ve en el Cockpit y en el notch; acá quedan el gate de consentimiento,
  // el botón de arranque y el estado de después, que es lo único que esta pantalla llega a mostrar.
  return (
    <>
      {dialogoDeConsentimiento}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          <AudioLines className="size-4 text-muted-foreground" />
          <span>
            {lista
              ? "Consulta grabada y transcrita."
              : otraEnCurso
                ? `Hay otra consulta grabando${sesion.pacienteNombre ? ` (${sesion.pacienteNombre})` : ""}. Detenela antes de empezar ésta.`
                : "Graba la consulta para que VetGPT redacte la nota."}
          </span>
          <HelpTip>
            Antes de grabar se pide el <b>consentimiento del titular</b> (Ley 1581). El audio se
            transcribe y VetGPT redacta la nota SOAP; el audio se elimina a los 4 días.
          </HelpTip>
        </div>
        <Button onClick={iniciar} disabled={otraEnCurso} variant={lista ? "outline" : "default"}>
          <Mic className="size-4" /> {lista ? "Grabar otra vez" : "Iniciar grabación"}
        </Button>
      </div>
    </>
  )
}
