"use client"

import * as React from "react"
import Link from "next/link"

import { AthosSidebarSection } from "@/components/athos/athos-sidebar-section"
import { NavClinic } from "@/components/nav-clinic"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import {
  BotIcon,
  CalendarIcon,
  CircleHelpIcon,
  GhostIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  PlugIcon,
  ReceiptIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  UsersIcon,
} from "lucide-react"

/* Glifo "chispa" de la marca Tuvetia (patrón del Sidebar del cliente). */
function BrandGlyph({ className }: { className?: string }) {
  return (
    <svg width="21" height="21" viewBox="0 0 64 64" aria-hidden className={className}>
      <path
        fill="var(--accent)"
        fillRule="evenodd"
        d="M32 8a24 24 0 1 0 0.001 0Z M44 22a5 5 0 1 0 0.001 0Z"
      />
    </svg>
  )
}

// La navegación partida en dos, como pidió el cliente para la v2: "en el consultorio tiene el athos
// y el phantom, es decir todo lo necesario para la consulta y en el CRM tiene lo demás".
//
// Antes era una sola lista plana de nueve ítems con Athos a la cabeza y sin rótulos. El corte
// separa dos modos de trabajo distintos: lo que se usa CON UN PACIENTE DELANTE y lo que se usa
// entre consultas.
//
// El Modo Fantasma queda en Consultorio, que es su lugar natural, y sigue emitiendo un <a href>
// real en el DOM: `onboarding-tour.tsx` engancha su tercer paso en `a[href="/dashboard/consultas"]`,
// y sacarlo o convertirlo en botón rompería el tour EN SILENCIO. Hay test que lo cubre.
//
// Ese <a> lo pone `<Link>`, que es lo que hay que usar y no un ancla cruda: ver `nav-main.tsx`.
//
// SE RENOMBRAN DOS ETIQUETAS, NO LAS RUTAS. "Calendario" → "Agenda" y "Facturación" → "Ventas" son
// los nombres del mockup. Las URLs siguen siendo `/dashboard/calendario` y `/dashboard/facturacion`:
// cambiarlas rompería enlaces ya compartidos, los selectores del tour y los tests, a cambio de nada
// que el vet pueda ver.
//
// "Modo Fantasma" NO se renombra a "Tomanotas" aunque el mockup lo llame así: es marca, la landing
// lo vende con ese nombre desde hace semanas, y cambiarlo en la app sola dejaría dos nombres para
// la misma cosa.
const data = {
  consultorio: [
    { title: "Athos", url: "/dashboard/asistente", icon: <BotIcon /> },
    { title: "Modo Fantasma", url: "/dashboard/consultas", icon: <GhostIcon /> },
  ],
  // EL ORDEN LO DICTÓ LUCIANO EL 19-AGO, y es el de la JORNADA: «como en el orden en el que tú
  // empezarías el día… el dashboard primero y que sea la vista predeterminada, después pacientes,
  // agenda, ventas».
  //
  // Y DASHBOARD VUELVE A ENCABEZAR. El 12-ago se lo había bajado con el argumento de que es una
  // superficie de LECTURA —se mira, no se trabaja en ella— y de que abrir en métricas no es abrir
  // en trabajo. El cliente decidió lo contrario por una razón mejor: al llegar a la clínica lo
  // primero no es actuar, es SABER CÓMO ESTÁ EL DÍA — cuántas citas, qué quedó pendiente. Es
  // también la pantalla en la que ahora se aterriza al entrar.
  //
  // TITULARES YA NO ESTÁ ACÁ. No se borró: pasó a ser una vista dentro de Pacientes
  // (`components/patients/vista-pacientes-titulares.tsx`), que es la fusión que pidió el cliente.
  // La ruta `/dashboard/owners` sigue existiendo y sigue siendo el único lugar donde vive el
  // consentimiento de grabación del titular — por eso la vista se conserva y no se disuelve.
  crm: [
    { title: "Dashboard", url: "/dashboard/tablero", icon: <LayoutDashboardIcon /> },
    { title: "Pacientes", url: "/dashboard/patients", icon: <UsersIcon /> },
    { title: "Agenda", url: "/dashboard/calendario", icon: <CalendarIcon /> },
    { title: "Ventas", url: "/dashboard/facturacion", icon: <ReceiptIcon /> },
    { title: "Comunicaciones", url: "/dashboard/comunicaciones", icon: <MessageCircleIcon /> },
  ],
  // «CONEXIONES» SE FUE DE ACÁ, y con otro nombre. David lo pidió el 12-ago: «el tema de
  // comunicaciones y conexiones, que le quede muy claro al usuario».
  //
  // Eran dos entradas contiguas, con nombres que comparten raíz y terminación, para cosas que no se
  // parecen: una es la BANDEJA donde llegan los mensajes de los titulares, la otra es donde se
  // enchufan WhatsApp, Gmail y el calendario. Se resuelve por los dos lados: el nombre deja de
  // rimar («Integraciones») y deja de estar pegado al otro.
  //
  // Y baja al bloque secundario porque es lo que es: se configura una vez y no se vuelve. Ahí abajo
  // está con Configuración y Ayuda, que es exactamente la misma clase de cosa.
  //
  // LA RUTA NO CAMBIA. Sigue siendo `/dashboard/conexiones`: hay enlaces compartidos, selectores del
  // tour y avisos del calendario que apuntan ahí. Cambiar la URL rompería todo eso a cambio de nada
  // que el vet pueda ver.
  navSecondary: [
    { title: "Integraciones", url: "/dashboard/conexiones", icon: <PlugIcon /> },
    { title: "Configuración", url: "/dashboard/settings", icon: <Settings2Icon /> },
    { title: "Ayuda", url: "/dashboard/ayuda", icon: <CircleHelpIcon /> },
  ],
}

/**
 * El acceso al riel de configuración desde cualquier pantalla.
 *
 * El riel completo vive en el dashboard, pero el vet pasa el día en la agenda o en una consulta: si
 * la única señal de que la clínica está a medio configurar estuviera en una pantalla que no visita,
 * "llenar la plataforma progresivamente" no pasa nunca. Esto es el recordatorio permanente, con el
 * número a la vista.
 *
 * Se retira solo al 100%, igual que el riel.
 *
 * SE LLAMA "PRIMEROS PASOS" Y NO "CONFIGURACIÓN". Decía "Configuración", y tres filas más abajo, en
 * el mismo bloque visual, está el enlace a los ajustes — que también dice "Configuración". Dos
 * etiquetas idénticas a la vista, que llevan a sitios distintos: ésta al riel de onboarding en
 * `/dashboard`, la otra a `/dashboard/settings`. Elegir entre las dos era cara o sello.
 */
function ChipConfiguracion({ porcentaje }: { porcentaje: number }) {
  if (porcentaje >= 100) return null
  return (
    <SidebarMenuButton
      tooltip={`Puesta a punto de la clínica: ${porcentaje}% completo`}
      render={<Link href="/dashboard" />}
      className="text-fg-muted"
    >
      <SlidersHorizontalIcon />
      <span>Primeros pasos</span>
      <span className="ml-auto font-mono text-[11px] tabular-nums text-brand-text group-data-[collapsible=icon]:hidden">
        {porcentaje}%
      </span>
    </SidebarMenuButton>
  )
}

export function AppSidebar({
  user,
  clinic,
  progresoConfiguracion,
  className,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string; avatar: string; role: string | null }
  clinic: { name: string; logoUrl: string | null }
  /** 0–100. Lo calcula `dashboard/layout.tsx`; el sidebar sólo lo muestra. */
  progresoConfiguracion: number
}) {
  return (
    // `app-theme-tokens` es por la variante MÓVIL: ahí el sidebar se pinta dentro de un `SheetContent`
    // que se portalea a <body>, o sea fuera del `.app-theme` que `dashboard/layout.tsx` pone en el
    // `SidebarProvider`. Sin esto `--accent` caía al `:root` y los tres puntos de marca de esta barra
    // —el glifo, el badge `bg-brand` de propuestas y la pestaña activa `border-brand` del panel de
    // Athos— salían en el brasa de la landing en vez del azul de la app. En escritorio es una
    // redeclaración de los mismos valores, inofensiva.
    <Sidebar collapsible="icon" className={cn("app-theme-tokens", className)} {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<Link href="/dashboard" />}
            >
              <BrandGlyph className="size-5!" />
              <span className="font-display text-base font-bold tracking-[-0.02em]">Tuvetia</span>
              {/* La insignia del demo del cliente. `group-data-[collapsible=icon]:hidden` porque en
                  la barra angosta sólo cabe el glifo. */}
              <span className="rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground group-data-[collapsible=icon]:hidden">
                BETA
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavClinic name={clinic.name} logoUrl={clinic.logoUrl} />
        {/* Cada grupo trae su rótulo, sus secciones y su acción: "Iniciar consulta" en Consultorio,
            "Nuevo paciente" en CRM. */}
        <NavMain consultorio={data.consultorio} crm={data.crm} />
        <SidebarMenu className="mt-auto px-2">
          <SidebarMenuItem>
            <ChipConfiguracion porcentaje={progresoConfiguracion} />
          </SidebarMenuItem>
        </SidebarMenu>
        {/* `mt-auto` se mudó al bloque de arriba: con los dos empujando, el de Configuración
            quedaba pegado al menú y Ayuda al fondo, con un hueco entre medio. */}
        <NavSecondary items={data.navSecondary} />
        {/* EL HISTORIAL, ABAJO DEL TODO. Lo pidió David el 19-ago —"las consultas y los chats,
            abajo y plegables"— y estaba justo debajo del menú principal, o sea en el medio: con
            cuarenta consultas cargadas empujaba Configuración y Ayuda fuera de la barra.

            Sigue apareciendo SÓLO dentro de Athos y del Modo Fantasma, así que en el resto de la
            app este lugar queda vacío y la barra se ve igual que siempre. */}
        <AthosSidebarSection />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
