"use client"

import * as React from "react"
import { MessageCircle, ShieldCheck } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// El aviso de primera visita a Conexiones: VetGPT NO responde solo.
//
// ── POR QUÉ EXISTE (Felipe, 26-ago) ───────────────────────────────────────────────────────────
//
// «dejar esto CLARO en onboarding y ajustes!!! un veterinario no es técnico, piensa en eso». El
// dato que un vet necesita ANTES de conectar su WhatsApp es qué va a pasar con sus clientes: si la
// máquina les va a hablar sola o no. La respuesta —arranca en modo sugerencia, nada sale sin
// aprobar— vivía en la letra pequeña de un toggle que sólo aparece DESPUÉS de conectar. O sea:
// la respuesta a la pregunta más importante estaba después de la decisión.
//
// ── POR QUÉ localStorage Y NO LA BASE ─────────────────────────────────────────────────────────
//
// Es una conveniencia de lector («ya me lo explicaste»), no un dato de la clínica: si el vet
// cambia de navegador y lo ve otra vez, no se pierde nada — un aviso de más es un clic; uno de
// menos es un malentendido con los clientes de la clínica. El try/catch es porque en modo privado
// o con datos bloqueados el accessor LANZA, y un aviso no puede tumbar la pantalla de conexiones.

const CLAVE = "conexiones-vetgpt-explicado"

export function VetgptNoRespondeSolo() {
  const [abierto, setAbierto] = React.useState(false)

  React.useEffect(() => {
    try {
      if (!window.localStorage.getItem(CLAVE)) {
        // setState EN un effect, con disable a propósito: leer localStorage no puede pasar en el
        // render (en el servidor no existe, y un lazy-init desincronizaría la hidratación — el
        // servidor pintaría cerrado y el cliente abierto). Es EL caso para el que los docs de React
        // reservan el patrón; el lint no distingue este uso del antipatrón que persigue.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAbierto(true)
      }
    } catch {
      // Sin storage no hay forma de recordar que ya se mostró: mejor no mostrarlo en bucle.
    }
  }, [])

  function entendido() {
    try {
      window.localStorage.setItem(CLAVE, new Date().toISOString())
    } catch {
      // Si no se puede guardar, igual se cierra: el peor caso es que reaparezca otro día.
    }
    setAbierto(false)
  }

  return (
    <Dialog open={abierto} onOpenChange={(v) => (v ? setAbierto(true) : entendido())}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand-text" aria-hidden />
            Antes de conectar: vos tenés el control
          </DialogTitle>
          <DialogDescription>Lo más importante de esta pantalla, en tres líneas.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 text-sm">
          <p>
            <b>VetGPT no le escribe solo a tus clientes.</b> Conectar WhatsApp no enciende ninguna
            respuesta automática: todo lo que VetGPT quiera mandar te llega como{" "}
            <b>sugerencia</b> y sale únicamente cuando vos lo apruebes.
          </p>
          <p className="flex items-start gap-2 text-muted-foreground">
            <MessageCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Si algún día querés que responda solo lo básico —horarios, ubicación, pedidos de
              cita—, eso se enciende aparte, con el botón «Respuestas automáticas», y se apaga
              cuando quieras. Lo clínico <b>nunca</b> se responde solo.
            </span>
          </p>
        </div>

        <DialogFooter>
          <Button onClick={entendido}>Entendido</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
