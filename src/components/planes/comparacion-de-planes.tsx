"use client"

import * as React from "react"

import { Button } from "@/components/ui/button"
import { IconoDeBullet } from "@/components/planes/iconos"
import { INCLUYE_FREE, INCLUYE_PRO, type Plan } from "@/lib/planes"
import { formatCOP } from "@/lib/facturacion/format"
import { cn } from "@/lib/utils"
import { Sparkles } from "lucide-react"

// Las dos tarjetas, una al lado de la otra: la forma que pidió el cliente, con el patrón de la
// pantalla de planes de ChatGPT.
//
// DECISIONES QUE NO SE VEN PERO IMPORTAN:
//
//   · **El plan actual no tiene botón, tiene una etiqueta.** Un botón deshabilitado que diga "Tu
//     plan actual" invita a hacerle clic y no pasa nada. La etiqueta dice lo mismo sin prometer una
//     acción.
//   · **El precio se pinta pero no se elige acá.** Llega ya resuelto por el servidor; el monto que
//     se cobra lo vuelve a resolver el servidor. La interfaz nunca decide cuánto se paga.
//   · **La lista de Pro sale de `lib/planes`, no está escrita acá.** Es la misma lista de la que
//     salen los cortes reales: una pantalla de precios que prometa algo que el gate no entrega es
//     una promesa incumplida con recibo.

function Tarjeta({
  destacada,
  children,
}: {
  destacada?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border p-6",
        destacada ? "border-brand bg-brand-soft/30" : "border-line bg-card",
      )}
    >
      {children}
    </div>
  )
}

function Lista({ bullets, acento }: { bullets: typeof INCLUYE_FREE; acento?: boolean }) {
  return (
    <ul className="mt-4 flex flex-col gap-3">
      {bullets.map((b) => (
        <li key={b.texto} className="flex items-start gap-2.5 text-[13px] leading-snug text-fg">
          <IconoDeBullet
            nombre={b.icono}
            className={cn("mt-px size-4 shrink-0", acento ? "text-brand-text" : "text-fg-faint")}
          />
          <span>{b.texto}</span>
        </li>
      ))}
    </ul>
  )
}

function EtiquetaPlanActual() {
  return (
    <div className="mt-5 rounded-full border border-line px-4 py-2 text-center text-[13px] font-medium text-fg-muted">
      Tu plan actual
    </div>
  )
}

export function ComparacionDePlanes({
  planActual,
  precioCentavos,
  /** Qué se pinta en el botón de Pro. La pantalla decide si contrata, si avisa o si no puede. */
  accionPro,
}: {
  planActual: Plan
  precioCentavos: number
  accionPro: React.ReactNode
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* ── Gratis ─────────────────────────────────────────────────────────────────────────── */}
      <Tarjeta>
        <p className="text-[13px] font-medium text-fg-muted">Gratis</p>
        <h2 className="mt-3 font-display text-2xl font-medium tracking-[-0.01em] text-fg">
          Toda tu clínica
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
          Pacientes, agenda, ventas y comunicaciones. Sin límite de tiempo y sin tarjeta.
        </p>
        <p className="mt-5 flex items-baseline gap-1">
          <span className="font-display text-4xl font-medium tracking-[-0.02em] text-fg">$ 0</span>
          <span className="text-sm text-fg-muted">/ mes</span>
        </p>

        {planActual === "free" ? (
          <EtiquetaPlanActual />
        ) : (
          // En Pro no se ofrece "bajar a gratis" como botón. Bajar de plan es cancelar, y eso vive
          // abajo, con su confirmación y su explicación de qué pasa con el período ya pagado.
          <div className="mt-5 h-[38px]" aria-hidden />
        )}

        <p className="mt-6 text-[13px] font-medium text-fg">Incluye:</p>
        <Lista bullets={INCLUYE_FREE} />
      </Tarjeta>

      {/* ── Pro ────────────────────────────────────────────────────────────────────────────── */}
      <Tarjeta destacada>
        <div className="flex items-start justify-between gap-3">
          <p className="text-[13px] font-medium text-fg-muted">Tuvetia Pro</p>
          {planActual !== "pro" && (
            <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[10px] font-semibold tracking-[0.08em] text-brand-text uppercase">
              Recomendado
            </span>
          )}
        </div>
        <h2 className="mt-3 font-display text-2xl font-medium tracking-[-0.01em] text-fg">
          Con inteligencia artificial
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-fg-muted">
          VetGPT y el Modo Fantasma, más todo lo que trabaja solo por vos.
        </p>
        <p className="mt-5 flex items-baseline gap-1">
          <span className="font-display text-4xl font-medium tracking-[-0.02em] text-fg">
            {formatCOP(precioCentavos)}
          </span>
          <span className="text-sm text-fg-muted">/ mes</span>
        </p>

        {planActual === "pro" ? <EtiquetaPlanActual /> : <div className="mt-5">{accionPro}</div>}

        <p className="mt-6 text-[13px] font-medium text-fg">Todo lo del plan Gratis, más:</p>
        <Lista bullets={INCLUYE_PRO} acento />
      </Tarjeta>
    </div>
  )
}

/** El botón que abre el formulario de pago. Vive acá para no repetir el icono y el texto. */
export function BotonSubirAPro({ onClick }: { onClick: () => void }) {
  return (
    <Button className="w-full" onClick={onClick}>
      <Sparkles className="size-4" /> Cambiar a Pro
    </Button>
  )
}
