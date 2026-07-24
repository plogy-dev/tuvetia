"use client"

// Conectar / sincronizar Google Calendar (opt-in por vet). Al conectar, reautoriza con el scope
// calendar.events (offline) y, al volver, captura el provider_refresh_token de la sesión y lo guarda
// server-side (route /api/google/calendar/connect). "Sincronizar" hace el pull incremental.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarCheck, CalendarPlus, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"

export function GoogleCalendarConnect({
  connected,
  onSynced,
}: {
  connected: boolean
  onSynced?: () => void
}) {
  const [supabase] = useState(() => createClient())
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const captured = useRef(false)

  // Al volver del consentimiento (?google=connected), captura el refresh token y lo persiste.
  useEffect(() => {
    if (captured.current) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("google") !== "connected") return
    captured.current = true
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const refreshToken = session?.provider_refresh_token
      url.searchParams.delete("google")
      window.history.replaceState({}, "", url.toString())
      if (!refreshToken) {
        toast.error("Google no devolvió un refresh token. Revisa el consentimiento (offline access).")
        return
      }
      const res = await fetch("/api/google/calendar/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (res.ok) {
        toast.success("Google Calendar conectado")
        router.refresh()
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(`No se pudo guardar la conexión: ${j.error ?? res.status}`)
      }
    })()
  }, [supabase, router])

  async function connect() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        scopes: CALENDAR_SCOPE,
        queryParams: { access_type: "offline", prompt: "consent" },
        redirectTo: `${window.location.origin}/dashboard/calendario?google=connected`,
      },
    })
    if (error) toast.error(`No se pudo iniciar la conexión con Google: ${error.message}`)
  }

  async function sync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/google/calendar/sync", { method: "POST" })
      const json = (await res.json()) as { changed?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success(`Sincronizado con Google (${json.changed ?? 0} cambios)`)
      onSynced?.()
    } catch (e) {
      toast.error(`No se pudo sincronizar: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }

  if (!connected) {
    return (
      <Button variant="outline" onClick={connect}>
        <CalendarPlus className="size-4" /> Conectar Google Calendar
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CalendarCheck className="size-4 text-green-600" /> Google conectado
      </span>
      <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
        {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Sincronizar
      </Button>
    </div>
  )
}
