"use client"

// Abrir y cerrar Tuvetia entera, desde el panel.
//
// POR QUÉ NO ES UN SWITCH, por lo mismo que `toggle-activacion.tsx`: un `<Switch>` se dispara con un
// clic suelto, y este clic decide si un veterinario que llega a la landing hoy puede registrarse o
// se topa con una pantalla que le pide un código que no tiene. Cerrar cuesta un paso más a
// propósito. Abrir es un clic: es la dirección segura —devuelve el comportamiento de siempre— y
// tiene que poder deshacerse rápido si se cerró por error.
//
// LOS DOS ESTADOS SE DESCRIBEN ENTEROS, no con la etiqueta del botón. «Cerrado» no le dice a nadie
// si las cuentas existentes siguen entrando, que es justo lo que quien está por apretar necesita
// saber y lo que da miedo no saber.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { DoorClosed, DoorOpen, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { cambiarModoDeLaPuerta } from "@/app/admin/acceso/actions"
import type { ModoDeLaPuerta } from "@/lib/puerta"
import { Button } from "@/components/ui/button"

export function InterruptorDeLaPuerta({ modo }: { modo: ModoDeLaPuerta }) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [guardando, setGuardando] = useState(false)

  const cerrada = modo === "cerrado"

  async function aplicar(nuevo: ModoDeLaPuerta) {
    setGuardando(true)
    const res = await cambiarModoDeLaPuerta({ modo: nuevo })
    setGuardando(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(res.mensaje)
    setConfirmando(false)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
            cerrada ? "bg-warn/15 text-warn" : "bg-ok/15 text-ok"
          }`}
        >
          {cerrada ? <DoorClosed className="size-4" /> : <DoorOpen className="size-4" />}
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="text-sm font-medium">
            {cerrada ? "Tuvetia está cerrada" : "Tuvetia está abierta"}
          </p>
          <p className="text-sm text-muted-foreground">
            {cerrada ? (
              <>
                Para <b>crear una cuenta nueva</b> hace falta un código de los de abajo. Quien ya
                tiene cuenta entra normal, y las invitaciones al equipo siguen funcionando.
              </>
            ) : (
              <>
                Cualquiera puede registrarse desde <b>/signup</b>, con o sin código. Un código
                compartido sigue sirviendo: define los días de prueba.
              </>
            )}
          </p>
        </div>
      </div>

      {cerrada ? (
        <div>
          <Button size="sm" variant="outline" disabled={guardando} onClick={() => void aplicar("abierto")}>
            {guardando ? <Loader2 className="size-4 animate-spin" /> : <DoorOpen className="size-4" />}
            Abrir el registro a todos
          </Button>
        </div>
      ) : confirmando ? (
        <div className="flex flex-col gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3">
          {/* QUÉ PASA CON QUIEN ESTÁ A MITAD DE CAMINO. Es la pregunta que se hace quien duda antes
              de apretar, y la respuesta —nadie se cae— es lo que hace que el botón se pueda usar. */}
          <p className="text-sm">
            A partir del clic, <b>nadie puede crear una cuenta sin código</b>. Nadie pierde el
            acceso: las cuentas que ya existen entran igual, y las invitaciones al equipo también.
            Se puede volver a abrir desde acá en cualquier momento.
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)} disabled={guardando}>
              Cancelar
            </Button>
            <Button size="sm" disabled={guardando} onClick={() => void aplicar("cerrado")}>
              {guardando ? <Loader2 className="size-4 animate-spin" /> : <DoorClosed className="size-4" />}
              Cerrar el registro
            </Button>
          </div>
        </div>
      ) : (
        <div>
          <Button size="sm" variant="outline" onClick={() => setConfirmando(true)}>
            <DoorClosed className="size-4" />
            Cerrar el registro
          </Button>
        </div>
      )}
    </div>
  )
}
