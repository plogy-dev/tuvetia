"use client"

// Conexión de WhatsApp de la clínica (vía Kapso, multi-tenant). "Conectar" abre el setup link
// hosteado donde el vet escanea el QR con su app de WhatsApp Business (coexistence: sigue usando su
// teléfono) o configura un número dedicado. Al volver (?whatsapp=connected) se refresca el estado.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Loader2, MessageCircle, QrCode, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

type WaStatus = "none" | "pending" | "connected"

export function WhatsappSettings({
  initialStatus,
  initialPhone,
}: {
  initialStatus: WaStatus
  initialPhone: string | null
}) {
  const router = useRouter()
  const [status, setStatus] = useState<WaStatus>(initialStatus)
  const [phone, setPhone] = useState<string | null>(initialPhone)
  const [busy, setBusy] = useState(false)
  const checked = useRef(false)

  // Al volver del setup link de Kapso (?whatsapp=connected), verificar la conexión una vez.
  useEffect(() => {
    if (checked.current) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("whatsapp") !== "connected") return
    checked.current = true
    url.searchParams.delete("whatsapp")
    window.history.replaceState({}, "", url.toString())
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function connect() {
    setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/connect", { method: "POST" })
      const json = (await res.json()) as { setup_url?: string; error?: string }
      if (!res.ok || !json.setup_url) throw new Error(json.error ?? `HTTP ${res.status}`)
      window.location.href = json.setup_url // el QR vive en la página hosteada de Kapso
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
      setBusy(false)
    }
  }

  async function refresh() {
    setBusy(true)
    try {
      const res = await fetch("/api/whatsapp/status", { method: "POST" })
      const json = (await res.json()) as { status?: WaStatus; phone_number?: string | null; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      setStatus(json.status ?? "pending")
      setPhone(json.phone_number ?? null)
      if (json.status === "connected") toast.success("WhatsApp conectado")
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo verificar la conexión: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }

  if (status === "connected") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm">
          <MessageCircle className="size-4 text-green-600" />
          Conectado{phone ? <span className="text-muted-foreground">· {phone}</span> : null}
        </span>
        <Button size="sm" variant="outline" onClick={refresh} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
          Verificar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Conecta el WhatsApp de tu clínica para centralizar la comunicación con los titulares.
        Escaneás un código QR con tu app de WhatsApp Business y <b>seguís usando tu teléfono como
        siempre</b>; los mensajes también llegan a TuvetIA.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={connect} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <QrCode className="size-4" />}
          {status === "pending" ? "Continuar conexión" : "Conectar WhatsApp"}
        </Button>
        {status === "pending" && (
          <Button variant="outline" onClick={refresh} disabled={busy}>
            Verificar conexión
          </Button>
        )}
      </div>
    </div>
  )
}
