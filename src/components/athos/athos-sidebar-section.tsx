"use client"

// Segundo nivel del sidebar para Athos: el historial a mano mientras trabajas con él, como en el
// recorrido del cliente. Se auto-oculta fuera de Athos y del Modo Fantasma, así que en el resto de
// la app no cuesta ni una consulta.
//
// SIN CAMBIOS DE ESQUEMA, a propósito:
//   · "Consultas" son la tabla `consultations` que ya existe.
//   · "Chats" son los hilos por paciente de `athos_messages`, agrupados igual que
//     `lib/athos-history.ts` hace para precargar la conversación.
//
// `athos_messages.patient_id` NO tiene clave foránea a `patients` (verificado contra la base), así
// que PostgREST no puede traer el nombre con un embed: los nombres van en una segunda consulta y se
// cruzan acá. En `consultations` sí hay FK y el embed funciona.
//
// El buscador filtra lo YA cargado, en el navegador. No navega ni vuelve a consultar.

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useSearchParams } from "next/navigation"
import { MessagesSquare, PlusIcon, SearchIcon, Stethoscope } from "lucide-react"

import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { bogotaDate } from "@/lib/date-utils"

const ESTADO_CONSULTA: Record<string, string> = {
  open: "Abierta",
  transcribing: "Transcribiendo",
  generating_note: "Generando nota",
  review: "En revisión",
  completed: "Completada",
}

/** Cuántas filas de cada lista se traen. Es un panel de acceso rápido, no un archivo completo. */
const TOPE_CONSULTAS = 40
const TOPE_MENSAJES = 400

type Item = { key: string; href: string; titulo: string; sub: string }

export function AthosSidebarSection() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const visible =
    pathname.startsWith("/dashboard/asistente") || pathname.startsWith("/dashboard/consultas")

  const [tab, setTab] = useState<"consultas" | "chats">("consultas")
  const [q, setQ] = useState("")
  const [consultas, setConsultas] = useState<Item[] | null>(null)
  const [chats, setChats] = useState<Item[] | null>(null)

  useEffect(() => {
    if (!visible || consultas !== null) return
    let vivo = true
    void (async () => {
      const supabase = createClient()
      const [cons, msgs, pts] = await Promise.all([
        supabase
          .from("consultations")
          .select("id, status, started_at, patient:patients(name)")
          .order("started_at", { ascending: false })
          .limit(TOPE_CONSULTAS),
        supabase
          .from("athos_messages")
          .select("patient_id, created_at")
          .not("patient_id", "is", null)
          .order("created_at", { ascending: false })
          .limit(TOPE_MENSAJES),
        supabase.from("patients").select("id, name").limit(500),
      ])
      if (!vivo) return

      const filasCons =
        (cons.data as unknown as
          | { id: string; status: string; started_at: string; patient: { name: string } | null }[]
          | null) ?? []
      setConsultas(
        filasCons.map((c) => ({
          key: c.id,
          href: `/dashboard/consultas/${c.id}`,
          titulo: c.patient?.name ?? "Sin paciente",
          sub: `${bogotaDate(c.started_at)} · ${ESTADO_CONSULTA[c.status] ?? c.status}`,
        })),
      )

      const nombres = new Map(
        ((pts.data as { id: string; name: string }[] | null) ?? []).map((p) => [p.id, p.name]),
      )
      // Las filas vienen de la más nueva a la más vieja, así que el primer avistamiento de cada
      // paciente ya es su último mensaje.
      const vistos = new Map<string, string>()
      for (const m of ((msgs.data as { patient_id: string; created_at: string }[] | null) ?? [])) {
        if (!vistos.has(m.patient_id)) vistos.set(m.patient_id, m.created_at)
      }
      setChats(
        [...vistos.entries()].map(([pid, ts]) => ({
          key: pid,
          href: `/dashboard/asistente?patient=${pid}`,
          titulo: nombres.get(pid) ?? "Paciente",
          sub: `Último mensaje · ${bogotaDate(ts)}`,
        })),
      )
    })()
    return () => {
      vivo = false
    }
  }, [visible, consultas])

  const activos = tab === "consultas" ? consultas : chats
  const filtro = q.trim().toLowerCase()
  const items = useMemo(
    () => (activos ?? []).filter((i) => !filtro || i.titulo.toLowerCase().includes(filtro)),
    [activos, filtro],
  )

  if (!visible) return null

  const pacienteActivo = searchParams.get("patient")

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              variant="outline"
              tooltip="Nuevo chat con Athos"
              render={<Link href="/dashboard/asistente" />}
            >
              <PlusIcon />
              <span>Nuevo chat con Athos</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        <div className="relative">
          <SearchIcon
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar por paciente…"
            aria-label="Buscar en el historial de Athos"
            className="h-8 pl-8 text-xs"
          />
        </div>

        {/* Los contadores salen de las listas YA cargadas, no de una consulta nueva. Van en `null`
            mientras se cargan, así que la pestaña no parpadea de "0" a su número real. */}
        <div className="flex gap-1 border-b border-sidebar-border">
          {(
            [
              [
                "consultas",
                "Consultas",
                <Stethoscope key="c" className="size-3.5" />,
                consultas?.length,
              ],
              ["chats", "Chats", <MessagesSquare key="m" className="size-3.5" />, chats?.length],
            ] as const
          ).map(([key, label, icon, total]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-pressed={tab === key}
              className={`-mb-px flex items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-xs transition-colors ${
                tab === key
                  ? "border-brand font-medium text-sidebar-foreground"
                  : "border-transparent text-muted-foreground hover:text-sidebar-foreground"
              }`}
            >
              {icon}
              {label}
              {total !== undefined && total > 0 && (
                <span className="text-[11px] text-muted-foreground">{total}</span>
              )}
            </button>
          ))}
        </div>

        {activos === null ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            {filtro
              ? "Ningún paciente con ese nombre."
              : tab === "consultas"
                ? "Todavía no hay consultas. Empieza una con «Iniciar consulta», aquí arriba."
                : "Todavía no has hablado con Athos sobre un paciente. Abre «Nuevo chat con Athos» y elige uno."}
          </p>
        ) : (
          <SidebarMenu>
            {items.map((i) => {
              const activo =
                tab === "chats"
                  ? pacienteActivo === i.key
                  : pathname === `/dashboard/consultas/${i.key}`
              return (
                <SidebarMenuItem key={i.key}>
                  <SidebarMenuButton
                    isActive={activo}
                    className="h-auto flex-col items-start gap-0.5 py-1.5"
                    render={<Link href={i.href} />}
                  >
                    <span className="w-full truncate text-xs font-medium">{i.titulo}</span>
                    <span className="w-full truncate text-[11px] text-muted-foreground">
                      {i.sub}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
