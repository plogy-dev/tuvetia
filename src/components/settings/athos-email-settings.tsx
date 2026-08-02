"use client"

// Conectar el correo que usa Athos — la cuenta de Google de CADA MIEMBRO, vía Composio.
//
// Es un clic: no hay contraseña de aplicación que generar ni 2FA que activar. El token vive del
// lado de Composio; Tuvetia nunca lo ve.
//
// Si el miembro no conectó nada, acá aparece la explicación de qué se gana conectándolo — no un
// botón mudo. Es la pantalla que va a ver el veterinario cuando le pida a Athos algo de correo y
// Athos le diga que primero conecte su cuenta.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, Loader2, Mail } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export function AthosEmailSettings({
  conectado,
  email,
  disponible,
}: {
  conectado: boolean
  email: string | null
  /** false = falta configurar Composio en el servidor. Se explica en vez de ofrecer un botón roto. */
  disponible: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<"conectar" | "desconectar" | null>(null)

  // Al volver de Google (?correo=conectado) la conexión ya quedó hecha del lado de Composio: solo
  // hay que refrescar para que el server component la lea.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get("correo") !== "conectado") return
    url.searchParams.delete("correo")
    window.history.replaceState({}, "", url.toString())
    toast.success("Correo conectado")
    router.refresh()
  }, [router])

  async function conectar() {
    setBusy("conectar")
    try {
      const res = await fetch("/api/composio/gmail/connect", { method: "POST" })
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? `HTTP ${res.status}`)
      // A Google, vía Composio. Vuelve al callbackUrl que fijó la ruta.
      window.location.href = json.url
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
      setBusy(null)
    }
  }

  async function desconectar() {
    setBusy("desconectar")
    try {
      const res = await fetch("/api/composio/gmail/disconnect", { method: "POST" })
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

  if (!disponible) {
    return (
      <p className="text-sm text-fg-muted">
        La conexión de correo no está disponible en este servidor todavía. Falta configurar Composio
        (<code>COMPOSIO_API_KEY</code> y <code>COMPOSIO_GMAIL_AUTH_CONFIG_ID</code>).
      </p>
    )
  }

  if (conectado) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <CheckCircle2 className="size-4 text-green-600" aria-hidden />
          {email ? <>Conectado como <b className="font-medium text-fg">{email}</b></> : "Correo conectado"}
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
      <div>
        <Button onClick={conectar} disabled={busy !== null}>
          {busy === "conectar" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Mail className="size-4" aria-hidden />
          )}
          Conectar Gmail
        </Button>
      </div>
      <p className="text-xs text-fg-faint">Outlook se agrega más adelante.</p>
    </div>
  )
}
