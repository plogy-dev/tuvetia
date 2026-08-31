"use client"

// Segundo nivel del sidebar para VetGPT: el historial a mano mientras trabajas con él, como en el
// recorrido del cliente. Se auto-oculta fuera de VetGPT y del Modo Fantasma, así que en el resto de
// la app no cuesta ni una consulta.
//
// SIN CAMBIOS DE ESQUEMA, a propósito:
//   · "Cuaderno" son la tabla `consultations` que ya existe (la pestaña se llamaba
//     "Consultas" hasta el 25-ago).
//   · "Chats" son los hilos por paciente de `athos_messages`, agrupados igual que
//     `lib/athos-history.ts` hace para precargar la conversación.
//
// `athos_messages.patient_id` NO tiene clave foránea a `patients` (verificado contra la base), así
// que PostgREST no puede traer el nombre con un embed: los nombres van en una segunda consulta y se
// cruzan acá. En `consultations` sí hay FK y el embed funciona.
//
// El buscador filtra lo YA cargado, en el navegador. No navega ni vuelve a consultar.
//
// ── PLEGABLE, Y ABAJO ───────────────────────────────────────────────────────────────────────────
//
// David, 19-ago: *"las consultas y los chats, abajo y plegables"*. Las dos mitades resuelven la
// misma molestia: con cuarenta consultas cargadas, este panel empujaba el resto de la barra fuera
// de la vista justo en la pantalla donde uno está trabajando.
//
// El "abajo" está en `app-sidebar.tsx` —es cuestión de orden—. El plegado EXISTIÓ acá y se quitó
// el 31-ago a pedido de David: el historial va siempre desplegado.
// molestando una vez por página.
//
// Y LA LISTA TIENE TECHO Y SCROLL PROPIO. Sin eso, "plegable" arregla el caso cerrado y deja el
// abierto igual de roto: cuarenta filas siguen empujando lo de abajo hasta sacarlo de la pantalla.

import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { MessagesSquare, PlusIcon, SearchIcon, Stethoscope, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { ESTADO_DE_CONSULTA } from "@/lib/consultas/estado"
import { createClient } from "@/lib/supabase/client"
import { Input } from "@/components/ui/input"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { bogotaDate } from "@/lib/date-utils"


/** Cuántas filas de cada lista se traen. Es un panel de acceso rápido, no un archivo completo. */
const TOPE_CONSULTAS = 40
const TOPE_MENSAJES = 400
// Menor que TOPE_MENSAJES porque estas filas SÍ cargan `content` completo (titulan los hilos
// generales con la primera pregunta): 150 mensajes generales cubren semanas de chats.
const TOPE_GENERALES = 150

type Item = { key: string; href: string; titulo: string; sub: string }

export function AthosSidebarSection() {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  // EN TODO EL DASHBOARD, no en dos pantallas (28-ago, David: «eso debería aparecer siempre»,
  // Felipe: «que persista 100%»). Antes esto era
  // `pathname.startsWith("/dashboard/asistente") || pathname.startsWith("/dashboard/consultas")`
  // — y la puerta de entrada es el TABLERO, y la PWA abre en el CALENDARIO. O sea que David
  // entraba, no veía su historial, y concluía —razonablemente— que se le había borrado. El panel
  // ni siquiera estaba en el DOM de la pantalla en la que él estaba parado.
  const visible = pathname.startsWith("/dashboard")

  const [tab, setTab] = useState<"consultas" | "chats">("consultas")
  const [q, setQ] = useState("")
  const [consultas, setConsultas] = useState<Item[] | null>(null)
  const [chats, setChats] = useState<Item[] | null>(null)
  // Un fallo de carga NO puede pintarse como lista vacía. Con la sesión caída, las consultas
  // devuelven 401 y el `?? []` de abajo lo convertía en «Todavía no hay consultas» — que es
  // exactamente lo que David reportó como «se me perdieron». Perder datos y no poder leerlos
  // son problemas distintos, y la pantalla tiene que distinguirlos.
  const [fallo, setFallo] = useState(false)
  // Sube cuando "Deshacer" restaura un chat: fuerza la recarga de la lista sin navegar.
  const [refresco, setRefresco] = useState(0)

  // La lista se REFRESCA al navegar (cambia la ruta o la query), no solo al montar: sin esto, el
  // chat que acabas de dejar con «Nuevo chat» no aparecía en el historial hasta recargar la página
  // — que es exactamente cuando lo estás buscando (reporte 26-ago: "no me carga los chats").
  // Los datos viejos se quedan pintados mientras llegan los nuevos: refrescar no parpadea.
  const rutaKey = `${pathname}?${searchParams.toString()}`
  useEffect(() => {
    if (!visible) return
    let vivo = true
    void (async () => {
      const supabase = createClient()
      const [cons, msgsPacientes, msgsGenerales, pts] = await Promise.all([
        supabase
          .from("consultations")
          .select("id, status, started_at, patient:patients(name)")
          .order("started_at", { ascending: false })
          .limit(TOPE_CONSULTAS),
        // DOS consultas de mensajes a propósito (auditoría 26-ago): la de PACIENTE va sin
        // `content` — traer 400 respuestas completas (hasta ~30 KB por turno con adjuntos) solo
        // para saber la fecha del último mensaje era el peso real del panel. El `content` solo lo
        // necesitan los hilos GENERALES para titularse con la primera pregunta del vet, y esos van
        // en su propia consulta con tope corto.
        supabase
          .from("athos_messages")
          .select("patient_id, created_at")
          .not("patient_id", "is", null)
          // Sin los chats "eliminados" de la vista (0095) — ver /api/athos/chats/ocultar.
          .is("hidden_at", null)
          .order("created_at", { ascending: false })
          .limit(TOPE_MENSAJES),
        supabase
          .from("athos_messages")
          .select("thread_key, role, content, created_at")
          .is("patient_id", null)
          .not("thread_key", "is", null)
          .is("hidden_at", null)
          .order("created_at", { ascending: false })
          .limit(TOPE_GENERALES),
        supabase.from("patients").select("id, name").limit(500),
      ])
      if (!vivo) return

      // Con CUALQUIERA de las cuatro consultas en error, el panel lo dice en vez de mentir un
      // vacío. Las cuatro juntas: si falla una (típicamente por sesión vencida) fallan todas.
      if (cons.error || msgsPacientes.error || msgsGenerales.error || pts.error) {
        setFallo(true)
        return
      }
      setFallo(false)

      const filasCons =
        (cons.data as unknown as
          | { id: string; status: string; started_at: string; patient: { name: string } | null }[]
          | null) ?? []
      setConsultas(
        filasCons.map((c) => ({
          key: c.id,
          href: `/dashboard/consultas/${c.id}`,
          titulo: c.patient?.name ?? "Sin paciente",
          sub: `${bogotaDate(c.started_at)} · ${ESTADO_DE_CONSULTA[c.status] ?? c.status}`,
        })),
      )

      const nombres = new Map(
        ((pts.data as { id: string; name: string }[] | null) ?? []).map((p) => [p.id, p.name]),
      )
      // Las filas vienen de la más nueva a la más vieja, así que el primer avistamiento de cada
      // hilo ya es su último mensaje. Hilos de PACIENTE (clave = patient_id, sin content) e hilos
      // GENERALES (clave = thread_key 0092), titulados con la primera pregunta del vet que se
      // encuentre (yendo de nuevo a viejo, la última vista es la primera de la conversación).
      const pacientes = new Map<string, string>()
      for (const m of (msgsPacientes.data as { patient_id: string; created_at: string }[] | null) ?? []) {
        if (!pacientes.has(m.patient_id)) pacientes.set(m.patient_id, m.created_at)
      }
      const generales = new Map<string, { ts: string; titulo: string }>()
      type FilaGeneral = { thread_key: string; role: string; content: string | null; created_at: string }
      for (const m of (msgsGenerales.data as FilaGeneral[] | null) ?? []) {
        const g = generales.get(m.thread_key) ?? { ts: m.created_at, titulo: "" }
        if (m.role === "user" && m.content?.trim()) {
          // El bloque de un documento adjunto no es título: se quita y queda la pregunta real.
          const sinAdjuntos = m.content
            .replace(/\[Documento adjunto: [^\]]+\]\n"""[\s\S]*?"""\s*/g, "")
            .trim()
          g.titulo = sinAdjuntos || "Chat con documento"
        }
        generales.set(m.thread_key, g)
      }
      const filasChats: (Item & { ts: string })[] = [
        ...[...pacientes.entries()].map(([pid, ts]) => ({
          key: pid,
          href: `/dashboard/asistente?patient=${pid}`,
          titulo: nombres.get(pid) ?? "Paciente",
          sub: `Último mensaje · ${bogotaDate(ts)}`,
          ts,
        })),
        ...[...generales.entries()].map(([clave, g]) => ({
          key: clave,
          href: `/dashboard/asistente?chat=${clave}`,
          titulo: g.titulo ? (g.titulo.length > 48 ? `${g.titulo.slice(0, 47)}…` : g.titulo) : "Chat general",
          sub: `Chat general · ${bogotaDate(g.ts)}`,
          ts: g.ts,
        })),
      ]
      // Mezclados por actividad, el más reciente arriba: el hilo que acabas de dejar es el que
      // más probablemente quieres retomar.
      filasChats.sort((a, b) => (a.ts < b.ts ? 1 : -1))
      setChats(filasChats.map(({ ts: _ts, ...item }) => item))
    })()
    return () => {
      vivo = false
    }
  }, [visible, rutaKey, refresco])

  // "Eliminar" un chat = quitarlo de la VISTA (0095): los mensajes quedan en la base y la memoria
  // del paciente intacta. Optimista: desaparece al clic; si el servidor falla, se recarga y el
  // toast lo dice. "Deshacer" restaura tal cual.
  // `claveNueva` la genera el handler inline (Date.now ahí está exento de react-hooks/purity;
  // acá adentro el compilador lo marca): es la clave del chat fresco al que se navega si el
  // eliminado era el que estaba abierto.
  async function ocultarChat(item: Item, claveNueva: number) {
    const esPaciente = item.href.includes("?patient=")
    const cuerpo = esPaciente
      ? { patient_id: item.key }
      : { thread_key: item.key }
    setChats((prev) => prev?.filter((c) => c.key !== item.key) ?? prev)
    const res = await fetch("/api/athos/chats/ocultar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accion: "ocultar", ...cuerpo }),
    }).catch(() => null)
    if (!res?.ok) {
      toast.error("No se pudo eliminar el chat del historial.")
      setRefresco((r) => r + 1) // recarga: el optimista se revierte con la verdad de la base
      return
    }
    // La marca del ocultado viaja al "Deshacer": restaura SOLO este borrado, no los chats del
    // mismo hilo que se ocultaron en borrados anteriores (auditoría 26-ago). Si la marca no llegó
    // (respuesta ilegible), NO se ofrece deshacer: un restaurar SIN marca es sin filtro — resucita
    // también ocultados históricos, que es justo el bug que la marca vino a cerrar.
    const { marca } = (await res.json().catch(() => ({}))) as { marca?: string }
    toast(`«${item.titulo}» eliminado del historial`, {
      action: marca
        ? {
            label: "Deshacer",
            onClick: () => {
              void fetch("/api/athos/chats/ocultar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ accion: "restaurar", marca, ...cuerpo }),
              })
                .then((r) => {
                  if (!r.ok) throw new Error(`HTTP ${r.status}`)
                  setRefresco((n) => n + 1)
                })
                .catch(() => toast.error("No se pudo restaurar el chat — reintentá desde el historial."))
            },
          }
        : undefined,
    })
    // Si era el chat ABIERTO, quedarse mirándolo sería seguir chateando en un hilo "eliminado":
    // se abre uno nuevo.
    if ((esPaciente && pacienteActivo === item.key) || (!esPaciente && chatActivo === item.key)) {
      router.push(`/dashboard/asistente?nuevo=${claveNueva}`)
    }
  }

  const activos = tab === "consultas" ? consultas : chats
  const filtro = q.trim().toLowerCase()
  const items = useMemo(
    () => (activos ?? []).filter((i) => !filtro || i.titulo.toLowerCase().includes(filtro)),
    [activos, filtro],
  )

  if (!visible) return null

  const pacienteActivo = searchParams.get("patient")
  const chatActivo = searchParams.get("chat")

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupContent className="flex flex-col gap-2">
        {/* LA CABECERA YA NO ES UN BOTÓN (31-ago). El plegable venía del pedido de David del
            19-ago («abajo y plegables»), y el mismo David lo revirtió el 28-ago al encontrarse
            el panel escondido: «eso debería aparecer siempre». Quien pliega una vez y lo olvida
            reencuentra un panel «vacío» semanas después — el mismo malentendido que este panel
            venía de causar con la ruta y con la cookie del sidebar. El techo con scroll propio
            de la lista (más abajo) es lo que impide que el historial abierto empuje al resto,
            que era el problema que el plegable venía a resolver. */}
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">Historial</p>

        <div id="athos-historial" className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            {/* BOTÓN, no Link a /dashboard/asistente: estando ya en esa pantalla, navegar a la
                misma URL no hace NADA — el botón "no funcionaba" (reporte 26-ago). `?nuevo=` con
                timestamp cambia en cada clic, así la navegación siempre ocurre y el asistente
                estrena un hilo general vacío (ver `claveNueva` en assistant.tsx). */}
            <SidebarMenuButton
              variant="outline"
              tooltip="Nuevo chat con VetGPT"
              onClick={() => router.push(`/dashboard/asistente?nuevo=${Date.now()}`)}
            >
              <PlusIcon />
              <span>Nuevo chat con VetGPT</span>
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
            aria-label="Buscar en el historial de VetGPT"
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
                // «Cuaderno», no «Consultas». Lo pidió David el 25-ago, y encaja: la columna donde
                // vive lo que se escribe en la consulta se llama `notebook` en la base desde
                // siempre. La CLAVE sigue siendo `consultas` — es el estado interno y la tabla que
                // consulta, y renombrarla no le cambiaría nada a nadie.
                "Cuaderno",
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

        {fallo ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            No se pudo cargar el historial. Recarga la página — y si sigue igual, vuelve a entrar.
          </p>
        ) : activos === null ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">Cargando…</p>
        ) : items.length === 0 ? (
          <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">
            {filtro
              ? "Ningún paciente con ese nombre."
              : tab === "consultas"
                ? "Todavía no hay consultas. Empieza una con «Iniciar consulta», aquí arriba."
                : "Todavía no has hablado con VetGPT sobre un paciente. Abre «Nuevo chat con VetGPT» y elige uno."}
          </p>
        ) : (
          // TECHO Y SCROLL PROPIO. Sin esto, plegar arregla el caso cerrado y deja el abierto
          // igual de roto: cuarenta filas siguen empujando lo de abajo hasta sacarlo de la barra.
          <SidebarMenu className="max-h-[38svh] overflow-y-auto">
            {items.map((i) => {
              const activo =
                tab === "chats"
                  ? pacienteActivo === i.key || chatActivo === i.key
                  : pathname === `/dashboard/consultas/${i.key}`
              return (
                <SidebarMenuItem key={i.key}>
                  <SidebarMenuButton
                    isActive={activo}
                    className="h-auto flex-col items-start gap-0.5 py-1.5"
                    render={<Link href={i.href} />}
                  >
                    <span className="w-full truncate pr-5 text-xs font-medium">{i.titulo}</span>
                    <span className="w-full truncate text-[11px] text-muted-foreground">
                      {i.sub}
                    </span>
                  </SidebarMenuButton>
                  {/* Eliminar DE LA VISTA (0095): los mensajes y la memoria del paciente quedan —
                      solo desaparece del historial. Solo en Chats: una consulta clínica no se
                      "elimina" desde una barra lateral. */}
                  {tab === "chats" && (
                    <SidebarMenuAction
                      aria-label={`Eliminar «${i.titulo}» del historial`}
                      onClick={() => void ocultarChat(i, Date.now())}
                      className="top-1.5"
                    >
                      <Trash2 className="size-3.5" />
                    </SidebarMenuAction>
                  )}
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        )}
        </div>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
