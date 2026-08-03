"use client"

// Conectar el correo que usa Athos — la cuenta de CADA MIEMBRO, vía Composio. Gmail u Outlook, uno
// de los dos.
//
// Es un clic: no hay contraseña de aplicación que generar ni 2FA que activar. El token vive del
// lado de Composio; Tuvetia nunca lo ve.
//
// Si el miembro no conectó nada, acá aparece la explicación de qué se gana conectándolo — no un
// botón mudo. Es la pantalla a la que lo manda Athos cuando le pide algo de correo sin tener cuenta.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Mail } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { NOMBRE_PROVEEDOR, type Proveedor } from "@/lib/composio/proveedores-nombres"

export function AthosEmailSettings({
  conectado,
  proveedor,
  email,
  disponibles,
}: {
  conectado: boolean
  proveedor: Proveedor | null
  email: string | null
  /** Proveedores configurados en el servidor. Vacío = falta configurar Composio. */
  disponibles: Proveedor[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<Proveedor | "desconectar" | null>(null)

  // Al volver del consentimiento (?correo=conectado) la conexión ya quedó hecha del lado de
  // Composio: solo hay que refrescar para que el server component la lea.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get("correo") !== "conectado") return
    url.searchParams.delete("correo")
    window.history.replaceState({}, "", url.toString())
    toast.success("Correo conectado")
    router.refresh()
  }, [router])

  async function conectar(p: Proveedor) {
    setBusy(p)
    try {
      const res = await fetch("/api/composio/correo/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: p }),
      })
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? `HTTP ${res.status}`)
      window.location.assign(json.url)
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
      setBusy(null)
    }
  }

  async function desconectar() {
    setBusy("desconectar")
    try {
      const res = await fetch("/api/composio/correo/disconnect", { method: "POST" })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success("Correo desconectado")
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo desconectar: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  if (disponibles.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        La conexión de correo no está disponible en este servidor todavía. Falta configurar Composio
        (<code>COMPOSIO_API_KEY</code> y el auth config del proveedor).
      </p>
    )
  }

  if (conectado) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <CheckCircle2 className="size-4 text-green-600" aria-hidden />
          {proveedor ? `${NOMBRE_PROVEEDOR[proveedor]} conectado` : "Correo conectado"}
          {email && (
            <>
              {" · "}
              <b className="font-medium text-fg">{email}</b>
            </>
          )}
        </span>
        <Button variant="outline" size="sm" onClick={desconectar} disabled={busy !== null}>
          {busy === "desconectar" && <Loader2 className="size-4 animate-spin" />}
          Desconectar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-fg-muted">
        Conectá tu cuenta para que Athos pueda <b>leer y responder</b> tus correos cuando se lo pidas
        — por ejemplo &ldquo;¿qué me escribió la dueña de Luna?&rdquo; o &ldquo;respondele que la
        esperamos el martes&rdquo;. Es un clic: no hace falta contraseña de aplicación.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {disponibles.map((p) => (
          <Button key={p} variant="outline" onClick={() => conectar(p)} disabled={busy !== null}>
            {busy === p ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Mail className="size-4" aria-hidden />
            )}
            Conectar {NOMBRE_PROVEEDOR[p]}
          </Button>
        ))}
      </div>
      <p className="text-xs text-fg-faint">Podés conectar uno de los dos, no ambos.</p>
    </div>
  )
}
