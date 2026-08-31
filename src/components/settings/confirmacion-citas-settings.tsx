"use client"

// El interruptor de la CONFIRMACIÓN al agendar.
//
// ── POR QUÉ ES UNA SECCIÓN APARTE DEL RECORDATORIO ─────────────────────────────────────────────
//
// Son dos mensajes distintos en dos momentos distintos, y una clínica puede querer uno y no el otro:
//
//   · La CONFIRMACIÓN sale en el instante en que se agenda. Es la que reemplaza la llamada de
//     «te confirmo que quedaste para el martes».
//   · El RECORDATORIO sale la mañana anterior. Es la que reduce el ausentismo.
//
// Meterlos en un solo interruptor obligaría a elegir los dos o ninguno, y el texto tendría que
// servir para ambos — «le recordamos la cita de mañana», mandado al agendar una cita de dentro de
// tres semanas, es un mensaje que confunde.
//
// ── ARRANCA APAGADO ────────────────────────────────────────────────────────────────────────────
//
// Igual que el recordatorio, y por lo mismo: encender mensajes automáticos hacia los clientes de
// una clínica que no lo pidió sería hablar en su nombre, y en Colombia además tratar datos
// personales para una finalidad que el titular no autorizó (Ley 1581).

import { useState, useTransition } from "react"
import { MessageCircle } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { guardarConfirmacionDeCitas } from "@/lib/citas/actions"
import { HUECOS_DE_CITA, LARGO_MAXIMO, revisarTexto } from "@/lib/citas/recordatorio"
import { PRESETS_CONFIRMACION, TEXTO_POR_DEFECTO_CONFIRMACION } from "@/lib/citas/textos"

export function ConfirmacionCitasSettings({
  activoInicial,
  textoInicial,
  puedeEditar,
}: {
  activoInicial: boolean
  textoInicial: string | null
  /** Sólo un administrador. Es la voz de la clínica hacia afuera, no una preferencia de pantalla. */
  puedeEditar: boolean
}) {
  const [isPending, startTransition] = useTransition()
  const [activo, setActivo] = useState(activoInicial)
  const [texto, setTexto] = useState(textoInicial ?? "")

  // La misma revisión que corre en el servidor. Acá es para avisar mientras se escribe; la que
  // manda es la del `action`, porque un formulario se salta.
  const problema = texto.trim() ? revisarTexto(texto.trim()) : null

  function guardar() {
    startTransition(async () => {
      // La guarda que devuelve los botones (28-ago): si esta promesa RECHAZA —sesión vencida,
      // red caída, o un id de Server Action viejo tras un deploy— React nunca cierra la
      // transición e `isPending` deja los botones deshabilitados hasta recargar.
      try {
        const r = await guardarConfirmacionDeCitas({ activo, texto: texto.trim() || null })
        if (r.ok) toast.success("Aviso al agendar guardado")
        else toast.error(r.error)
    
      } catch (e) {
        toast.error(`No se pudo completar la acción: ${(e as Error)?.message ?? e}`)
      }
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm font-medium">Aviso al agendar</span>
          <span className="text-xs text-muted-foreground">
            Sale por WhatsApp apenas se guarda la cita, al titular con teléfono cargado. Quien la
            agenda ve en pantalla si llegó y, si no, por qué.
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
        <div>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <label htmlFor="texto-confirmacion" className="text-xs font-medium text-muted-foreground">
              El mensaje
            </label>
            <span className="font-mono text-[11px] tabular-nums text-fg-faint">
              {texto.length}/{LARGO_MAXIMO}
            </span>
          </div>
          {/* Los presets rellenan, no guardan: el vet revisa y guarda con el botón de
              siempre — ver el comentario de PRESETS_CONFIRMACION. */}
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-fg-faint">Sugerencias:</span>
            {PRESETS_CONFIRMACION.map((p) => (
              <button
                key={p.nombre}
                type="button"
                onClick={() => setTexto(p.texto)}
                disabled={isPending || !puedeEditar}
                className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-fg-muted transition-colors hover:border-brand hover:text-brand-text disabled:opacity-50"
              >
                {p.nombre}
              </button>
            ))}
          </div>
          <Textarea
            id="texto-confirmacion"
            rows={3}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            disabled={isPending || !puedeEditar}
            placeholder={TEXTO_POR_DEFECTO_CONFIRMACION}
            maxLength={LARGO_MAXIMO}
          />
          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted-foreground">
            <MessageCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            {/* LOS HUECOS SE ENUMERAN, no se dejan adivinar: escribir `{mascota}` en vez de
                `{paciente}` produce un mensaje que sale literal al cliente. */}
            Podés usar {HUECOS_DE_CITA.map((h) => `{${h}}`).join(", ")}. Vacío = el texto por
            defecto. Debajo del mensaje van solos los links de «📅 agregar al calendario» y
            «📍 cómo llegar» — no hace falta escribirlos.
          </p>
          {problema && <p className="mt-1 text-xs text-warn">{problema}</p>}
        </div>
      )}

      {puedeEditar && (
        <div>
          <Button size="sm" onClick={guardar} disabled={isPending || Boolean(problema)}>
            Guardar
          </Button>
        </div>
      )}
    </div>
  )
}
