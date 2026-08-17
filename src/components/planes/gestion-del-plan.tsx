"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { AlertTriangle, CreditCard, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { BotonSubirAPro, ComparacionDePlanes } from "@/components/planes/comparacion-de-planes"
import { FormularioDePago } from "@/components/planes/formulario-de-pago"
import { ESTADO_LEGIBLE, seRenueva, type EstadoSuscripcion, type Plan } from "@/lib/planes"
import { fmtDate } from "@/lib/facturacion/format"

// La parte con estado de la pantalla de Plan: abrir el formulario, cancelar, y el aviso de mora.
//
// LA PANTALLA ES SERVIDOR y esto es la isla de cliente. Así el plan, el historial y la tarjeta se
// pintan sin parpadeo y sin consultas desde el navegador; lo único que vive acá es lo que necesita
// manejar clics.

export function GestionDelPlan({
  plan,
  estado,
  renuevaEn,
  cancelado,
  tarjeta,
  precioCentavos,
  esAdmin,
  pagosDisponibles,
}: {
  plan: Plan
  estado: EstadoSuscripcion
  renuevaEn: string | null
  cancelado: boolean
  tarjeta: { marca: string; ultimos4: string } | null
  precioCentavos: number
  esAdmin: boolean
  /** `false` cuando faltan las credenciales de Wompi. La comparación se muestra igual. */
  pagosDisponibles: boolean
}) {
  const router = useRouter()
  const [formAbierto, setFormAbierto] = React.useState(false)
  const [confirmarCancelar, setConfirmarCancelar] = React.useState(false)
  const [cancelando, setCancelando] = React.useState(false)

  async function cancelar() {
    setCancelando(true)
    const res = await fetch("/api/suscripcion/cancelar", { method: "POST" })
    const json = (await res.json().catch(() => null)) as { error?: string; mensaje?: string } | null
    setCancelando(false)
    setConfirmarCancelar(false)

    if (!res.ok) {
      toast.error(json?.error ?? "No pudimos cancelar la suscripción.")
      return
    }
    toast.success(json?.mensaje ?? "Suscripción cancelada.")
    router.refresh()
  }

  // Qué se pinta en el botón de la tarjeta de Pro. Tres casos distintos y ninguno es un botón que
  // lleve a una pared: quien no puede pagar recibe la razón, no un clic que falla.
  const accionPro = !esAdmin ? (
    <p className="rounded-lg border border-line-soft bg-surface px-3 py-2 text-center text-[13px] text-fg-muted">
      Sólo el administrador de la clínica puede contratar el plan.
    </p>
  ) : !pagosDisponibles ? (
    <p className="rounded-lg border border-line-soft bg-surface px-3 py-2 text-center text-[13px] text-fg-muted">
      Los pagos todavía no están habilitados. Escribinos y lo activamos.
    </p>
  ) : (
    <BotonSubirAPro onClick={() => setFormAbierto(true)} />
  )

  return (
    <>
      {/* ── El aviso de mora va ARRIBA de todo ────────────────────────────────────────────────
          En `past_due` la clínica SIGUE con Pro —está en período de gracia— así que la pantalla no
          se ve distinta y sin este aviso nadie se enteraría de que hay un cobro fallado hasta que
          el plan cae solo. Es el único estado donde hace falta que alguien actúe. */}
      {estado === "past_due" && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
          <div className="text-sm">
            <p className="font-medium text-fg">No pudimos cobrar tu suscripción.</p>
            <p className="mt-1 text-fg-muted">
              Seguís con Pro por ahora y vamos a reintentar
              {renuevaEn ? ` el ${fmtDate(renuevaEn)}` : " en los próximos días"}. Si la tarjeta
              venció, cargá una nueva para no perder el acceso.
            </p>
            {esAdmin && pagosDisponibles && (
              <Button size="sm" className="mt-3" onClick={() => setFormAbierto(true)}>
                <CreditCard className="size-4" /> Actualizar la tarjeta
              </Button>
            )}
          </div>
        </div>
      )}

      {cancelado && plan === "pro" && (
        <div className="mb-4 rounded-xl border border-line bg-surface p-4 text-sm">
          <p className="font-medium text-fg">Tu suscripción está cancelada.</p>
          <p className="mt-1 text-fg-muted">
            Seguís con Pro hasta {renuevaEn ? fmtDate(renuevaEn) : "que termine el período pagado"};
            después tu clínica pasa al plan gratis. No se borra nada de lo que ya tenés.
          </p>
          {esAdmin && pagosDisponibles && (
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setFormAbierto(true)}>
              Reactivar
            </Button>
          )}
        </div>
      )}

      <ComparacionDePlanes planActual={plan} precioCentavos={precioCentavos} accionPro={accionPro} />

      {/* ── Estado y medio de pago ──────────────────────────────────────────────────────────── */}
      {plan === "pro" && (
        <div className="mt-6 rounded-xl border border-line bg-card p-4">
          <h3 className="text-sm font-semibold text-fg">Tu suscripción</h3>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-fg-muted">Estado</dt>
            <dd className="font-medium text-fg">{ESTADO_LEGIBLE[estado]}</dd>

            {seRenueva(estado) && renuevaEn && (
              <>
                <dt className="text-fg-muted">{cancelado ? "Termina" : "Se renueva"}</dt>
                <dd className="font-medium text-fg">{fmtDate(renuevaEn)}</dd>
              </>
            )}

            <dt className="text-fg-muted">Medio de pago</dt>
            <dd className="font-medium text-fg">
              {tarjeta ? (
                <span className="font-mono">
                  {tarjeta.marca} ···· {tarjeta.ultimos4}
                </span>
              ) : (
                // Es el caso de `cortesia`: Pro sin tarjeta. Decirlo evita la pregunta obvia de
                // "¿por qué tengo Pro si nunca puse una tarjeta?".
                "Sin tarjeta — cortesía de Tuvetia"
              )}
            </dd>
          </dl>

          {esAdmin && seRenueva(estado) && !cancelado && (
            <div className="mt-4 flex flex-wrap gap-2">
              {pagosDisponibles && (
                <Button variant="outline" size="sm" onClick={() => setFormAbierto(true)}>
                  <CreditCard className="size-4" /> Cambiar la tarjeta
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setConfirmarCancelar(true)}>
                Cancelar suscripción
              </Button>
            </div>
          )}
        </div>
      )}

      <FormularioDePago
        abierto={formAbierto}
        onCerrar={() => setFormAbierto(false)}
        precioCentavos={precioCentavos}
      />

      {/* La confirmación dice QUÉ PASA, no "¿estás seguro?". Lo importante es que no pierde el mes
          que ya pagó ni los datos — que es exactamente lo que teme quien cancela. */}
      <Dialog open={confirmarCancelar} onOpenChange={(o) => !o && setConfirmarCancelar(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Cancelar la suscripción?</DialogTitle>
            <DialogDescription>
              Seguís con Pro hasta {renuevaEn ? fmtDate(renuevaEn) : "el final del período pagado"}.
              Después tu clínica pasa al plan gratis: Athos y el Modo Fantasma se apagan, pero tus
              pacientes, consultas, notas y facturas quedan intactos y accesibles.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmarCancelar(false)} disabled={cancelando}>
              Seguir con Pro
            </Button>
            <Button variant="destructive" onClick={cancelar} disabled={cancelando}>
              {cancelando && <Loader2 className="size-4 animate-spin" />}
              Cancelar suscripción
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
