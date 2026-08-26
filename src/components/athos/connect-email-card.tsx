"use client"

// Tarjeta que aparece EN EL CHAT cuando VetGPT necesita el correo del veterinario y todavía no está
// conectado.
//
// Antes ese caso salía como una línea gris de error debajo de la respuesta. Es el peor lugar donde
// dejarlo: el vet acaba de pedir algo concreto ("mandale un correo a la dueña de Luna"), y lo que
// recibe es un texto que no puede accionar y que además no le dice a dónde ir. Acá se conecta sin
// salir de la conversación, y al volver aterriza en el chat, no en Conexiones.

import { useEffect, useState } from "react"
import { Mail, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { NOMBRE_PROVEEDOR, type Proveedor } from "@/lib/composio/proveedores-nombres"

export function ConnectEmailCard() {
  // Cuáles ofrecer lo decide el servidor: depende de qué auth configs estén puestos. Se pregunta en
  // vez de cablear los dos, para no mostrar un botón que va a fallar al tocarlo.
  const [proveedores, setProveedores] = useState<Proveedor[] | null>(null)
  const [busy, setBusy] = useState<Proveedor | null>(null)

  useEffect(() => {
    let vivo = true
    fetch("/api/composio/correo/connect")
      .then((r) => r.json())
      .then((j: { proveedores?: Proveedor[] }) => {
        if (vivo) setProveedores(j.proveedores ?? [])
      })
      .catch(() => {
        if (vivo) setProveedores([])
      })
    return () => {
      vivo = false
    }
  }, [])

  async function conectar(proveedor: Proveedor) {
    setBusy(proveedor)
    try {
      const res = await fetch("/api/composio/correo/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor, volverA: "/dashboard/asistente" }),
      })
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? `HTTP ${res.status}`)
      window.location.assign(json.url)
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
      setBusy(null)
    }
  }

  return (
    <div className="rounded-xl border border-line bg-card p-3.5 text-sm">
      <div className="mb-1.5 flex items-center gap-2">
        <Mail className="size-4 shrink-0 text-brand" aria-hidden />
        <span className="font-medium text-fg">Conectá tu correo para que pueda escribir por vos</span>
      </div>
      <p className="mb-3 text-fg-muted">
        Uso <b>tu</b> cuenta, no una de la clínica: el titular recibe el correo de vos y te responde a
        vos. Nunca escribo sin que lo apruebes antes.
      </p>
      {proveedores !== null && proveedores.length === 0 ? (
        <p className="text-xs text-fg-faint">
          La conexión de correo todavía no está habilitada en este servidor.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {(proveedores ?? []).map((p) => (
            <Button key={p} size="sm" onClick={() => conectar(p)} disabled={busy !== null}>
              {busy === p ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Mail className="size-4" aria-hidden />
              )}
              Conectar {NOMBRE_PROVEEDOR[p]}
            </Button>
          ))}
          <span className="text-xs text-fg-faint">Es un clic — no hace falta contraseña.</span>
        </div>
      )}
    </div>
  )
}
