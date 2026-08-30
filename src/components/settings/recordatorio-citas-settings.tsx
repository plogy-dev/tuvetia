"use client"

// Los ajustes del recordatorio de cita.
//
// ── POR QUÉ ESTA PANTALLA DICE CUÁNDO SALE DE VERDAD ──────────────────────────────────────────
//
// El barrido corre UNA VEZ AL DÍA (cuelga del cron de las 9 a. m.), así que «24 horas antes» se
// cumple como «la mañana anterior»: para una cita de mañana a las 10, el mensaje sale hoy a las 9.
//
// Se dice en la pantalla, con esas palabras. Una pantalla que promete «24 horas exactas» y entrega
// otra cosa no se descubre acá — se descubre cuando un titular reclama que no le avisaron a tiempo,
// y para entonces nadie relaciona una cosa con la otra.
//
// Por lo mismo sólo se ofrecen múltiplos de un día: «6 horas antes» sería aceptar una configuración
// que la máquina no puede cumplir.
//
// ── Y POR QUÉ LA VISTA PREVIA ─────────────────────────────────────────────────────────────────
//
// Se edita un texto con huecos y el titular recibe otro. «La cita de {paciente}» se lee bien con
// llaves y hay que verlo sin ellas para saber si suena a la clínica — que es lo único que ninguna
// validación puede decir.

import { useMemo, useState, useTransition } from "react"
import { CalendarClock, RotateCcw, Save } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { guardarRecordatorioDeCitas } from "@/lib/citas/actions"
import {
  LARGO_MAXIMO,
  TEXTO_POR_DEFECTO,
  diasDeAnticipacion,
  llenarTexto,
  revisarTexto,
} from "@/lib/citas/recordatorio"

/** Sólo múltiplos de un día: es lo que un barrido diario puede cumplir. */
const ANTICIPACIONES = [
  { horas: 24, etiqueta: "1 día antes" },
  { horas: 48, etiqueta: "2 días antes" },
  { horas: 72, etiqueta: "3 días antes" },
] as const

/** Valores de muestra para la vista previa. No salen de ninguna cita real. */
const MUESTRA = {
  paciente: "Milo",
  fecha: "martes, 26 de agosto",
  hora: "10:30 a. m.",
  clinica: "tu clínica",
}

export function RecordatorioCitasSettings({
  activoInicial,
  horasIniciales,
  textoInicial,
  puedeEditar,
}: {
  activoInicial: boolean
  horasIniciales: number
  textoInicial: string | null
  /** Sólo el administrador de la clínica: esto define lo que se le escribe a sus clientes. */
  puedeEditar: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [activo, setActivo] = useState(activoInicial)
  const [horas, setHoras] = useState(horasIniciales)
  const [texto, setTexto] = useState(textoInicial ?? TEXTO_POR_DEFECTO)

  const problema = useMemo(() => (texto.trim() ? revisarTexto(texto) : null), [texto])
  const dias = diasDeAnticipacion(horas)
  const esElDePorDefecto = texto.trim() === TEXTO_POR_DEFECTO

  function guardar() {
    startTransition(async () => {
      const r = await guardarRecordatorioDeCitas({
        activo,
        horas,
        texto: esElDePorDefecto ? null : texto,
      })
      if (r.ok) {
        toast.success(
          activo
            ? "Listo. Los recordatorios saldrán en el barrido de la mañana."
            : "Recordatorios de cita desactivados.",
        )
      } else {
        toast.error(r.error)
      }
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Recordatorio de cita al titular</span>
          <span className="text-xs text-muted-foreground">
            Sale por WhatsApp a los titulares con teléfono cargado. Las citas canceladas no llevan
            aviso, y cada cita recibe uno solo.
          </span>
        </div>
        <Button
          size="sm"
          variant={activo ? "default" : "outline"}
          onClick={() => setActivo((v) => !v)}
          disabled={isPending || !puedeEditar}
          aria-pressed={activo}
        >
          {activo ? "Activado" : "Desactivado"}
        </Button>
      </div>

      {activo && (
        <>
          <div>
            <span className="block text-xs font-medium text-muted-foreground">
              Con cuánta anticipación
            </span>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {ANTICIPACIONES.map((a) => (
                <Button
                  key={a.horas}
                  size="sm"
                  variant={horas === a.horas ? "default" : "outline"}
                  onClick={() => setHoras(a.horas)}
                  disabled={isPending || !puedeEditar}
                  aria-pressed={horas === a.horas}
                >
                  {a.etiqueta}
                </Button>
              ))}
            </div>
            {/* CUÁNDO SALE DE VERDAD. El barrido es diario, así que la anticipación se cumple por
                día y no por hora. Decirlo acá es lo que evita que se descubra por un reclamo. */}
            <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              El aviso sale en el barrido de las 9 a. m., {dias === 1 ? "el día" : `los ${dias} días`}{" "}
              {dias === 1 ? "anterior" : "antes"} a la cita. Para una cita de mañana a las 10, el
              mensaje sale hoy a las 9.
            </p>
          </div>

          <div>
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <label htmlFor="texto-recordatorio" className="text-xs font-medium text-muted-foreground">
                Qué se le escribe
              </label>
              {!esElDePorDefecto && (
                <button
                  type="button"
                  onClick={() => setTexto(TEXTO_POR_DEFECTO)}
                  disabled={isPending || !puedeEditar}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-fg"
                >
                  <RotateCcw className="size-3" aria-hidden />
                  Volver al texto por defecto
                </button>
              )}
            </div>
            <textarea
              id="texto-recordatorio"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              rows={3}
              maxLength={LARGO_MAXIMO}
              disabled={!puedeEditar}
              aria-invalid={problema ? true : undefined}
              className={`w-full rounded-lg border bg-surface px-3 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
                problema ? "border-warn" : "focus-visible:border-ring"
              }`}
            />
            <p className="mt-1 text-xs text-muted-foreground">
              Podés usar <code className="rounded bg-muted px-1">{"{paciente}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{fecha}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{hora}"}</code> y{" "}
              <code className="rounded bg-muted px-1">{"{clinica}"}</code>.{" "}
              <strong>{"{fecha}"} y {"{hora}"} son obligatorios</strong>: sin eso el titular no sabe
              cuándo es la cita.
            </p>
            {problema ? (
              <p className="mt-1 text-xs text-warn">{problema}</p>
            ) : (
              <p className="mt-1 text-xs text-muted-foreground">
                <span className="font-medium">Se verá así:</span>{" "}
                {llenarTexto(texto.trim() || TEXTO_POR_DEFECTO, MUESTRA)}
                {/* El bloque de links lo anexa la app, no la plantilla — se avisa para que el
                    vet no lo escriba a mano y salga dos veces (28-ago). */}
                <span className="mt-0.5 block text-fg-faint">
                  + 📍 «Cómo llegar» con la dirección de la clínica (si está cargada en Ajustes).
                </span>
              </p>
            )}
          </div>
        </>
      )}

      <div className="flex items-center gap-3">
        <Button size="sm" onClick={guardar} disabled={isPending || !puedeEditar}>
          <Save className="size-4" aria-hidden />
          {isPending ? "Guardando…" : "Guardar"}
        </Button>
        {!puedeEditar && (
          <span className="text-xs text-muted-foreground">
            Sólo un administrador de la clínica puede cambiar esto.
          </span>
        )}
      </div>
    </div>
  )
}
