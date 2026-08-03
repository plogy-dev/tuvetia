"use client"

import * as React from "react"

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
  ContactIcon,
  GhostIcon,
  LayoutDashboardIcon,
  MessageCircleIcon,
  PlugIcon,
  ReceiptIcon,
  Settings2Icon,
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

// Una sola lista, en el orden del demo del cliente (`tuvetia.com/app/athos`).
//
// Antes Athos y el Modo Fantasma vivían en un grupo aparte rotulado "Copiloto clínico", y el
// comentario de acá decía que eso copiaba su sidebar. No era cierto: en su demo ese grupo no
// existe — Athos es sencillamente el PRIMER ítem del menú, sin rótulo que lo separe del resto.
//
// El Modo Fantasma baja con las demás secciones. Ya no encabeza, pero sigue siendo un ítem: es la
// única vía directa a la lista de consultas desde cualquier pantalla, y —esto es lo que decide—
// `onboarding-tour.tsx:97` engancha su tercer paso en `a[href="/dashboard/consultas"]`. Sacarlo del
// sidebar habría roto el tour EN SILENCIO, sin que fallara ningún test.
//
// Lo que ellos no tienen y nosotros sí, y se queda: Dashboard, Titulares, Configuración, Ayuda y el
// nombre real de la clínica en `NavClinic` (su demo corre con una sola clínica ficticia, por eso le
// alcanza con el "Tuvetia BETA" de la cabecera).
//
// Ojo al tocar el markup: los pasos del tour son selectores CSS sobre `a[href="/dashboard/..."]`,
// así que estos ítems tienen que seguir renderizando un <a href> de verdad y visible.
const data = {
  navMain: [
    { title: "Athos", url: "/dashboard/asistente", icon: <BotIcon /> },
    { title: "Dashboard", url: "/dashboard", icon: <LayoutDashboardIcon /> },
    { title: "Pacientes", url: "/dashboard/patients", icon: <UsersIcon /> },
    { title: "Modo Fantasma", url: "/dashboard/consultas", icon: <GhostIcon /> },
    { title: "Titulares", url: "/dashboard/owners", icon: <ContactIcon /> },
    { title: "Calendario", url: "/dashboard/calendario", icon: <CalendarIcon /> },
    { title: "Facturación", url: "/dashboard/facturacion", icon: <ReceiptIcon /> },
    { title: "Comunicaciones", url: "/dashboard/comunicaciones", icon: <MessageCircleIcon /> },
    { title: "Conexiones", url: "/dashboard/conexiones", icon: <PlugIcon /> },
  ],
  navSecondary: [
    { title: "Configuración", url: "/dashboard/settings", icon: <Settings2Icon /> },
    { title: "Ayuda", url: "/dashboard/ayuda", icon: <CircleHelpIcon /> },
  ],
}

export function AppSidebar({
  user,
  clinic,
  className,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string; avatar: string }
  clinic: { name: string; logoUrl: string | null }
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
              render={<a href="/dashboard" />}
            >
              <BrandGlyph className="size-5!" />
              <span className="font-display text-base font-bold tracking-[-0.02em]">Tuvetia</span>
              {/* La insignia del demo del cliente. `group-data-[collapsible=icon]:hidden` porque en
                  la barra angosta sólo cabe el glifo. */}
              <span className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-muted-foreground group-data-[collapsible=icon]:hidden">
                BETA
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavClinic name={clinic.name} logoUrl={clinic.logoUrl} />
        {/* `NavMain` trae la lista de secciones Y los dos botones de acción, en ese orden — como en
            el demo, donde "Iniciar consulta" va DEBAJO del menú, no encima. */}
        <NavMain items={data.navMain} />
        {/* Segundo nivel: sólo aparece dentro de Athos y del Modo Fantasma, y se paga solo ahí.
            Va después de los botones, que es donde el cliente lo tiene. */}
        <AthosSidebarSection />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
