"use client"

import * as React from "react"
import Link from "next/link"
import { Sparkles } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { IconoDeBullet } from "@/components/planes/iconos"
import { usePlan } from "@/components/planes/plan-provider"
import { INCLUYE_PRO, MENSAJE_REQUIERE_PRO, type Capacidad } from "@/lib/planes"
import { formatCOP } from "@/lib/facturacion/format"

// La ventana que aparece cuando alguien en plan gratis intenta usar algo de Pro.
//
// ── QUÉ NO HACE, Y ES LO IMPORTANTE ────────────────────────────────────────────────────────────
//
// **No cobra acá.** El formulario de tarjeta vive en `/dashboard/plan` y esto sólo lleva hasta él.
// Meter el pago dentro de una ventana que se abrió porque el vet quería hacer OTRA cosa es pedirle
// una tarjeta a alguien que estaba en medio de una consulta. La ventana explica y ofrece; la
// decisión se toma en su propia pantalla, sin prisa.
//
// **No repite la comparación completa.** La tabla free-vs-Pro es de `/dashboard/plan`. Acá va lo
// que Pro agrega y nada más: quien abrió esto ya sabe qué tiene, le falta saber qué le falta.
//
// ── POR QUÉ NOMBRA LA CAPACIDAD ────────────────────────────────────────────────────────────────
//
// El título dice "VetGPT es parte del plan Pro" y no "Subí de plan". La diferencia importa: el vet
// acaba de hacer algo concreto —escribir un mensaje, apretar iniciar consulta— y la ventana tiene
// que conectar con eso. Una ventana genérica se lee como publicidad; una que nombra lo que acabás
// de intentar se lee como una respuesta.

export function ModalSubirAPro({
  capacidad,
  abierto,
  onCerrar,
}: {
  capacidad: Capacidad
  abierto: boolean
  onCerrar: () => void
}) {
  const { precioCentavos, esAdmin } = usePlan()

  return (
    <Dialog open={abierto} onOpenChange={(o) => !o && onCerrar()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-brand-soft">
            <Sparkles className="size-5 text-brand-text" aria-hidden />
          </div>
          <DialogTitle>{MENSAJE_REQUIERE_PRO[capacidad]}</DialogTitle>
          <DialogDescription>
            Tu clínica está en el plan gratis, que incluye todo el CRM sin límite de tiempo. Pro
            agrega las funciones que trabajan con inteligencia artificial.
          </DialogDescription>
        </DialogHeader>

        <ul className="mt-5 flex flex-col gap-2.5">
          {INCLUYE_PRO.map((b) => (
            <li key={b.texto} className="flex items-start gap-2.5 text-[13px] leading-snug text-fg">
              <IconoDeBullet nombre={b.icono} className="mt-px size-4 shrink-0 text-brand-text" />
              <span>{b.texto}</span>
            </li>
          ))}
        </ul>

        {precioCentavos > 0 && (
          <p className="mt-5 text-sm text-fg-muted">
            <span className="font-mono text-lg tabular-nums text-fg">{formatCOP(precioCentavos)}</span>{" "}
            al mes, para toda la clínica.
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onCerrar}>
            Ahora no
          </Button>
          {/* UN VETERINARIO NO PUEDE PAGAR, y la ventana no le ofrece un botón que lo lleve a una
              pantalla donde va a encontrarse con "sólo el administrador". Le dice a quién pedírselo,
              que es lo único accionable desde donde está. */}
          {esAdmin ? (
            <Button render={<Link href="/dashboard/plan" />} onClick={onCerrar}>
              <Sparkles className="size-4" /> Ver el plan Pro
            </Button>
          ) : (
            <Button disabled title="Sólo el administrador de la clínica puede contratar el plan">
              Pedíselo a tu administrador
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * El estado de la ventana, para no repetirlo en cada sitio que la abre.
 *
 * Devuelve `pedirPro()` —que abre— y el nodo ya montado. Quien lo usa no maneja `useState` ni sabe
 * de la ventana: sólo llama a `pedirPro()` cuando el gate lo frena y pinta `{ventana}`.
 */
export function useModalPro(capacidad: Capacidad) {
  const [abierto, setAbierto] = React.useState(false)

  return {
    pedirPro: React.useCallback(() => setAbierto(true), []),
    ventana: (
      <ModalSubirAPro capacidad={capacidad} abierto={abierto} onCerrar={() => setAbierto(false)} />
    ),
  }
}
