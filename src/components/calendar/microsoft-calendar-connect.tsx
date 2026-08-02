"use client"

// Conectar Outlook Calendar manualmente: fallback para quien entró con email/Google, o con Microsoft
// antes de este cambio (login-form/signup-form ya piden el scope y auto-conectan en el callback). Al
// conectar, reautoriza con el scope Calendars.ReadWrite (offline_access) y, al volver, captura el
// provider_refresh_token de la sesión y lo guarda server-side (route /api/microsoft/calendar/connect).
// Espejo de google-calendar-connect.tsx — ver ese archivo para el porqué del auto-sync en el cliente.

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarCheck, CalendarPlus, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { MICROSOFT_CALENDAR_SCOPE } from "@/lib/microsoft-calendar-scope"

export function MicrosoftCalendarConnect({
  connected,
  canConnect,
  onSynced,
}: {
  connected: boolean
  canConnect: boolean
  onSynced?: () => void
}) {
  const [supabase] = useState(() => createClient())
  const router = useRouter()
  const [syncing, setSyncing] = useState(false)
  const captured = useRef(false)
  const autoSynced = useRef(false)

  // Al volver del consentimiento (?microsoft=connected), captura el refresh token y lo persiste.
  useEffect(() => {
    if (captured.current) return
    const url = new URL(window.location.href)
    if (url.searchParams.get("microsoft") !== "connected") return
    captured.current = true
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      const refreshToken = session?.provider_refresh_token
      url.searchParams.delete("microsoft")
      window.history.replaceState({}, "", url.toString())
      if (!refreshToken) {
        toast.error("Microsoft no devolvió un refresh token. Revisá el consentimiento (offline_access).")
        return
      }
      const res = await fetch("/api/microsoft/calendar/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
      if (res.ok) {
        toast.success("Outlook Calendar conectado")
        router.refresh()
      } else {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        toast.error(`No se pudo guardar la conexión: ${j.error ?? res.status}`)
      }
    })()
  }, [supabase, router])

  // Sync automático en segundo plano al montar, si ya está conectado (no bloquea el render de la
  // página). `sync` es function declaration, hoisted.
  useEffect(() => {
    if (!connected || autoSynced.current) return
    autoSynced.current = true
    void sync()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected])

  async function connect() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "azure",
      options: {
        scopes: `email ${MICROSOFT_CALENDAR_SCOPE}`,
        redirectTo: `${window.location.origin}/dashboard/calendario?microsoft=connected`,
      },
    })
    if (error) toast.error(`No se pudo iniciar la conexión con Microsoft: ${error.message}`)
  }

  async function sync() {
    setSyncing(true)
    try {
      const res = await fetch("/api/microsoft/calendar/sync", { method: "POST" })
      const json = (await res.json()) as { changed?: number; error?: string }
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
      toast.success(`Sincronizado con Outlook (${json.changed ?? 0} cambios)`)
      onSynced?.()
    } catch (e) {
      toast.error(`No se pudo sincronizar: ${(e as Error).message}`)
    } finally {
      setSyncing(false)
    }
  }

  if (!connected) {
    // Solo el administrador de la clínica puede conectar (0048_calendar_admin_redesign: una sola
    // cuenta por clínica). Al resto se le explica el estado en vez de mostrar un botón que le
    // fallaría con 403.
    if (!canConnect) {
      return (
        <span className="text-xs text-muted-foreground">El administrador no conectó Outlook Calendar</span>
      )
    }
    return (
      <Button variant="outline" onClick={connect}>
        <CalendarPlus className="size-4" /> Conectar Outlook Calendar
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <CalendarCheck className="size-4 text-green-600" /> Outlook conectado
      </span>
      <Button variant="outline" size="sm" onClick={sync} disabled={syncing}>
        {syncing ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Sincronizar
      </Button>
    </div>
  )
}
