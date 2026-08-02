"use client"

// Conectar el calendario personal — Google u Outlook, a elección (calendario v3).
//
// Reemplaza a los dos botones que vivían en la página de Calendario. Tres cosas cambian respecto de
// lo anterior, y las tres son la razón del rediseño:
//
//   1. NADA SE CONECTA SOLO. Antes el login guardaba el token sin que nadie lo pidiera; el vet se
//      enteraba de que su calendario estaba sincronizado cuando veía sus eventos personales en la
//      agenda de la clínica.
//   2. EL CALENDARIO ES DE CADA USUARIO, no de la clínica. Las citas caen en el calendario del
//      veterinario asignado.
//   3. UNA SOLA VÍA. Tuvetia empuja sus citas; no lee nada del calendario. Por eso no hay botón
//      "Sincronizar": no hay nada que traer.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarCheck, CalendarPlus, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { GOOGLE_CALENDAR_SCOPE } from "@/lib/google-calendar-scope"
import { MICROSOFT_CALENDAR_SCOPE } from "@/lib/microsoft-calendar-scope"

export type CalendarProvider = "google" | "microsoft"

const NOMBRE: Record<CalendarProvider, string> = {
  google: "Google Calendar",
  microsoft: "Outlook Calendar",
}

/** Proveedor de OAuth (Supabase) por proveedor de calendario. */
const OAUTH: Record<CalendarProvider, "google" | "azure"> = {
  google: "google",
  microsoft: "azure",
}

export function CalendarSettings({ connected }: { connected: CalendarProvider | null }) {
  const [supabase] = useState(() => createClient())
  const router = useRouter()
  const [busy, setBusy] = useState<CalendarProvider | "disconnect" | null>(null)
  const captured = useRef(false)

  // Al volver del consentimiento (?calendar=google|microsoft), captura el refresh token y lo
  // persiste. El parámetro dice QUÉ se estaba conectando; el token se valida contra el proveedor
  // real de la sesión antes de mandarlo (ver más abajo).
  useEffect(() => {
    if (captured.current) return
    const url = new URL(window.location.href)
    const volviendo = url.searchParams.get("calendar") as CalendarProvider | null
    if (volviendo !== "google" && volviendo !== "microsoft") return
    captured.current = true
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      url.searchParams.delete("calendar")
      window.history.replaceState({}, "", url.toString())

      const refreshToken = session?.provider_refresh_token
      if (!refreshToken) {
        toast.error(
          `${NOMBRE[volviendo]} no devolvió un token de acceso prolongado. Revisá el consentimiento e intentá de nuevo.`,
        )
        return
      }
      // `provider_refresh_token` es el del proveedor de la SESIÓN, no el del botón que se apretó. Sin
      // este chequeo, volver acá con una sesión de otro proveedor guardaba su token en la fila
      // equivocada, y recién fallaba al empujar una cita — con un error que no señalaba la causa.
      const sessionProvider = session?.user?.app_metadata?.provider
      if (sessionProvider !== OAUTH[volviendo]) {
        toast.error(
          `La sesión activa es de ${sessionProvider ?? "otro proveedor"}, no de ${NOMBRE[volviendo]}. Intentá de nuevo desde el botón.`,
        )
        return
      }

      const res = await fetch(`/api/${volviendo}/calendar/connect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (res.ok) {
        toast.success(`${NOMBRE[volviendo]} conectado`)
        router.refresh()
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(j.error ?? `No se pudo guardar la conexión (${res.status})`)
      }
    })()
  }, [supabase, router])

  async function connect(provider: CalendarProvider) {
    setBusy(provider)
    const scopes =
      provider === "google" ? GOOGLE_CALENDAR_SCOPE : `email ${MICROSOFT_CALENDAR_SCOPE}`
    const { error } = await supabase.auth.signInWithOAuth({
      provider: OAUTH[provider],
      options: {
        scopes,
        // Google necesita el par offline+consent para devolver refresh token; Azure lo resuelve con
        // el scope offline_access que ya va en MICROSOFT_CALENDAR_SCOPE.
        ...(provider === "google"
          ? { queryParams: { access_type: "offline", prompt: "consent" } }
          : {}),
        redirectTo: `${window.location.origin}/dashboard/conexiones?calendar=${provider}`,
      },
    })
    if (error) {
      toast.error(`No se pudo iniciar la conexión: ${error.message}`)
      setBusy(null)
    }
  }

  async function disconnect() {
    if (!connected) return
    setBusy("disconnect")
    try {
      const res = await fetch(`/api/${connected}/calendar/disconnect`, { method: "POST" })
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

  if (connected) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
          <CalendarCheck className="size-4 text-green-600" aria-hidden />
          {NOMBRE[connected]} conectado
        </span>
        <Button variant="outline" size="sm" onClick={disconnect} disabled={busy !== null}>
          {busy === "disconnect" && <Loader2 className="size-4 animate-spin" />}
          Desconectar
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={() => connect("google")} disabled={busy !== null}>
        {busy === "google" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CalendarPlus className="size-4" aria-hidden />
        )}
        Conectar Google Calendar
      </Button>
      <Button variant="outline" onClick={() => connect("microsoft")} disabled={busy !== null}>
        {busy === "microsoft" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <CalendarPlus className="size-4" aria-hidden />
        )}
        Conectar Outlook Calendar
      </Button>
    </div>
  )
}
