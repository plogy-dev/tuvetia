"use client"

import * as React from "react"

import { AthosSidebarSection } from "@/components/athos/athos-sidebar-section"
import { NavClinic } from "@/components/nav-clinic"
import { NavDocuments } from "@/components/nav-documents"
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

// Orden y agrupación del sidebar del cliente, con lo que nuestro producto tiene de más.
//
// Athos y el Modo Fantasma van ARRIBA del todo: para el cliente son lo principal, y así se lee.
// Después el resto de secciones en su orden. Conservamos Dashboard y Titulares (ellos no los
// tienen), Configuración y Ayuda, y el nombre real de la clínica en `NavClinic` — donde ellos
// ponen un "Tuvetia BETA" fijo.
//
// Las URL no cambian: esto es orden, etiquetas y una entrada nueva. Ojo al tocar el markup:
// `onboarding-tour.tsx` engancha sus pasos con selectores `a[href="/dashboard/..."]`, así que
// estos ítems tienen que seguir renderizando un <a href> de verdad.
const data = {
  copiloto: [
    { name: "Athos", url: "/dashboard/asistente", icon: <BotIcon /> },
    { name: "Modo Fantasma", url: "/dashboard/consultas", icon: <GhostIcon /> },
  ],
  navMain: [
    { title: "Dashboard", url: "/dashboard", icon: <LayoutDashboardIcon /> },
    { title: "Pacientes", url: "/dashboard/patients", icon: <UsersIcon /> },
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
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string; avatar: string }
  clinic: { name: string; logoUrl: string | null }
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="data-[slot=sidebar-menu-button]:p-1.5!"
              render={<a href="/dashboard" />}
            >
              <BrandGlyph className="size-5!" />
              <span className="font-display text-base font-bold tracking-[-0.02em]">Tuvetia</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavClinic name={clinic.name} logoUrl={clinic.logoUrl} />
        <NavDocuments label="Copiloto clínico" items={data.copiloto} />
        {/* Segundo nivel: sólo aparece dentro de Athos y del Modo Fantasma, y se paga solo ahí. */}
        <AthosSidebarSection />
        <NavMain items={data.navMain} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
