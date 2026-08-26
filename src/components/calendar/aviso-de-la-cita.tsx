"use client"

// La ventana que aparece después de guardar una cita y dice POR DÓNDE se le avisó al titular.
//
// ── POR QUÉ NO ALCANZABA CON EL TOAST ──────────────────────────────────────────────────────────
//
// Guardar una cita mostraba "Cita creada" y listo. Eso no responde la única pregunta que el vet se
// hace después de agendar —¿se enteró el titular?— así que la respuesta seguía siendo llamarlo, que
// es exactamente el trabajo que agendar en el sistema venía a ahorrar.
//
// Acá se ven los dos canales con su estado: el WhatsApp al número de la ficha y la invitación de
// calendario. Y cuando alguno no salió, dice POR QUÉ con palabras accionables — "el titular no
// tiene teléfono cargado" se arregla en un lugar distinto que "el aviso al agendar está apagado", y
// un genérico obliga a adivinar cuál de los dos fue.
//
// ── NO BLOQUEA NADA ────────────────────────────────────────────────────────────────────────────
//
// La cita YA está guardada cuando esto aparece. Se cierra con la X, con Escape y con el botón: es
// un acuse de recibo, no un paso del formulario. Frenar al vet para que confirme que leyó un aviso
// sería cobrarle dos clics por cada cita.

import { CalendarCheck, CheckCircle2, MessageCircle, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export type CanalDeAviso = "whatsapp" | "calendario"

export type ResultadoDeAviso = {
  canal: CanalDeAviso
  ok: boolean
  /** A dónde salió: el teléfono, o a quiénes se invitó. Listo para mostrar. */
  destino: string | null
  motivo: string | null
}

const ICONO = { whatsapp: MessageCircle, calendario: CalendarCheck } as const
const NOMBRE = {
  whatsapp: "WhatsApp al titular",
  calendario: "Invitación de calendario",
} as const

/**
 * La frase de una línea del encabezado.
 *
 * NUNCA dice "avisado" cuando no se avisó. Es la tentación obvia —queda más limpio— y sería la
 * mentira más cara de esta pantalla: el vet daría por hecho que el titular sabe.
 */
export function resumenDeAvisos(resultados: readonly ResultadoDeAviso[]): string {
  const nombres = resultados
    .filter((r) => r.ok)
    .map((r) => (r.canal === "whatsapp" ? "WhatsApp" : "el calendario"))
  if (nombres.length === 0) return "No se le avisó al titular todavía."
  if (nombres.length === 1) return `Se le avisó al titular por ${nombres[0]}.`
  return `Se le avisó al titular por ${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}.`
}

export function AvisoDeLaCita({
  abierto,
  onCerrar,
  titulo,
  resultados,
}: {
  abierto: boolean
  onCerrar: () => void
  /** "Cita creada", "Cita actualizada"… Lo que acaba de pasar. */
  titulo: string
  /** `null` mientras los canales contestan. */
  resultados: ResultadoDeAviso[] | null
}) {
  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-ok-soft">
            <CheckCircle2 className="size-5 text-ok" aria-hidden />
          </div>
          <DialogTitle>{titulo}</DialogTitle>
          <DialogDescription>
            {resultados ? resumenDeAvisos(resultados) : "Avisándole al titular…"}
          </DialogDescription>
        </DialogHeader>

        {resultados ? (
          <ul className="mt-4 flex flex-col gap-2">
            {resultados.map((r) => {
              const Icono = ICONO[r.canal]
              return (
                <li
                  key={r.canal}
                  className="flex items-start gap-3 rounded-lg border border-line bg-card p-3"
                >
                  <Icono
                    className={`mt-0.5 size-4 shrink-0 ${r.ok ? "text-ok" : "text-fg-faint"}`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-[13.5px] font-medium text-fg">{NOMBRE[r.canal]}</span>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          r.ok ? "bg-ok-soft text-ok" : "bg-warn-soft text-warn"
                        }`}
                      >
                        {r.ok ? "Enviado" : "No salió"}
                      </span>
                    </div>
                    {/* EL DESTINO SE DICE SIEMPRE que haya salido: es lo que deja al vet verificar
                        que el número de la ficha era el correcto sin ir a buscarlo. */}
                    {r.ok && r.destino && (
                      <p className="mt-0.5 truncate font-mono text-[12px] text-fg-muted">
                        {r.destino}
                      </p>
                    )}
                    {!r.ok && r.motivo && (
                      <p className="mt-0.5 text-[12.5px] leading-snug text-fg-muted">{r.motivo}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          // La ventana abre enseguida con el título y el detalle llega cuando los canales contestan.
          // Esperar a tenerlos dejaba un segundo largo en el que el vet no sabía si la cita se había
          // guardado.
          <div className="mt-4 flex flex-col gap-2" aria-hidden>
            <div className="h-[58px] animate-pulse rounded-lg border border-line bg-muted/40" />
            <div className="h-[58px] animate-pulse rounded-lg border border-line bg-muted/40" />
          </div>
        )}

        {resultados && resultados.every((r) => !r.ok) && (
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-warn/40 bg-warn-soft p-3 text-[13px] text-fg">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>
              La cita quedó guardada en la agenda, pero <b>el titular no recibió ningún aviso</b>.
            </span>
          </p>
        )}

        <DialogFooter>
          <Button onClick={onCerrar} disabled={!resultados}>
            Entendido
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
