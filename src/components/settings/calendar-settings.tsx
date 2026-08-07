"use client"

// Conectar el calendario de la clínica — Google Calendar u Outlook Calendar, los dos vía Composio.
//
// Tres cosas que son el porqué del diseño actual:
//
//   1. NADA SE CONECTA SOLO. Antes el login guardaba el token sin que nadie lo pidiera; el vet se
//      enteraba de que su calendario estaba sincronizado cuando veía sus eventos personales en la
//      agenda de la clínica.
//   2. EL CALENDARIO ES DEL ADMINISTRADOR. Las citas de la clínica se crean ahí, y el titular y el
//      veterinario asignado quedan invitados. Por eso este componente sólo se le muestra a él: la
//      conexión de cualquier otro miembro no cambiaría nada.
//   3. UNA SOLA VÍA. Tuvetia empuja sus citas; no lee nada del calendario. Por eso no hay botón
//      "Sincronizar": no hay nada que traer.
//
// El camino anterior de Outlook —OAuth por Supabase, capturando `provider_refresh_token` al volver—
// se retiró. Tenía un defecto que Composio elimina: ese token es el del proveedor con el que se
// INICIÓ SESIÓN, no el del botón que se apretó, y había que verificarlo en el cliente y en la ruta
// para que un login con Microsoft no dejara su token guardado como si fuera de Google.

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarCheck, CalendarPlus, Loader2, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

export type CalendarProvider = "google" | "outlook"

const NOMBRE: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  outlook: "Outlook Calendar",
}

export function CalendarSettings({
  connected,
  /** Si desconectar también le saca el correo a Athos: con Microsoft es la misma cuenta. */
  compartidoConElCorreo = false,
}: {
  connected: CalendarProvider | null
  compartidoConElCorreo?: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<CalendarProvider | "disconnect" | null>(null)
  const [disponibles, setDisponibles] = useState<CalendarProvider[] | null>(null)

  // Cuáles ofrecer lo decide el servidor: depende de qué auth configs estén puestos. Se pregunta en
  // vez de cablear los dos, para no mostrar un botón que va a fallar al tocarlo.
  useEffect(() => {
    let vivo = true
    fetch("/api/composio/calendario/connect")
      .then((r) => r.json())
      .then((j: { proveedores?: CalendarProvider[] }) => {
        if (vivo) setDisponibles(j.proveedores ?? [])
      })
      .catch(() => {
        if (vivo) setDisponibles([])
      })
    return () => {
      vivo = false
    }
  }, [])

  // Al volver del consentimiento (?calendario=conectado) la conexión ya está hecha del lado de
  // Composio: sólo hay que refrescar para que el server component la lea.
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get("calendario") !== "conectado") return
    url.searchParams.delete("calendario")
    window.history.replaceState({}, "", url.toString())
    toast.success("Calendario conectado")
    router.refresh()
  }, [router])

  async function connect(provider: CalendarProvider) {
    setBusy(provider)
    try {
      const res = await fetch("/api/composio/calendario/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proveedor: provider }),
      })
      const json = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? `HTTP ${res.status}`)
      window.location.assign(json.url)
    } catch (e) {
      toast.error(`No se pudo iniciar la conexión: ${(e as Error).message}`)
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!connected) return
    setBusy("disconnect")
    try {
      const res = await fetch("/api/composio/calendario/disconnect", { method: "POST" })
      const j = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
      toast.success(`${NOMBRE[connected]} desconectado`)
      router.refresh()
    } catch (e) {
      toast.error(`No se pudo desconectar: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  if (disponibles !== null && disponibles.length === 0) {
    return (
      <p className="text-sm text-fg-muted">
        La conexión de calendario no está disponible en este servidor todavía. Falta configurar
        Composio (<code>COMPOSIO_API_KEY</code> y el auth config del proveedor).
      </p>
    )
  }

  if (connected) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
            <CalendarCheck className="size-4 text-ok" aria-hidden />
            {NOMBRE[connected]} conectado
          </span>
          <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null}>
            {busy === "disconnect" && <Loader2 className="size-4 animate-spin" />}
            Desconectar
          </Button>
        </div>
        {compartidoConElCorreo && (
          <p className="flex items-start gap-2 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm text-fg">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
            <span>
              El calendario y el correo de Microsoft son <b>la misma cuenta</b>: desconectar acá
              también le saca a Athos el acceso a tu correo.
            </span>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(disponibles ?? []).map((p) => (
        <Button key={p} variant="outline" onClick={() => connect(p)} disabled={busy !== null}>
          {busy === p ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <CalendarPlus className="size-4" aria-hidden />
          )}
          Conectar {NOMBRE[p]}
        </Button>
      ))}
    </div>
  )
}
