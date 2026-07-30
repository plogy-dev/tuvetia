"use client"

import * as React from "react"

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
import { LayoutDashboardIcon, UsersIcon, ContactIcon, CalendarIcon, MessageCircleIcon, ReceiptIcon, Settings2Icon, CircleHelpIcon, BotIcon, GhostIcon } from "lucide-react"

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

const data = {
  navMain: [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: (
        <LayoutDashboardIcon
        />
      ),
    },
    {
      title: "Pacientes",
      url: "/dashboard/patients",
      icon: (
        <UsersIcon
        />
      ),
    },
    {
      title: "Titulares",
      url: "/dashboard/owners",
      icon: (
        <ContactIcon
        />
      ),
    },
    {
      title: "Calendario",
      url: "/dashboard/calendario",
      icon: (
        <CalendarIcon
        />
      ),
    },
    {
      title: "Comunicaciones",
      url: "/dashboard/comunicaciones",
      icon: (
        <MessageCircleIcon
        />
      ),
    },
    {
      title: "Facturación",
      url: "/dashboard/facturacion",
      icon: (
        <ReceiptIcon
        />
      ),
    },
  ],
  navSecondary: [
    {
      title: "Configuración",
      url: "/dashboard/settings",
      icon: (
        <Settings2Icon
        />
      ),
    },
    {
      title: "Ayuda",
      url: "/dashboard/ayuda",
      icon: (
        <CircleHelpIcon
        />
      ),
    },
  ],
  documents: [
    {
      name: "Athos",
      url: "/dashboard/asistente",
      icon: (
        <BotIcon
        />
      ),
    },
    {
      name: "Phantom",
      url: "/dashboard/consultas",
      icon: (
        <GhostIcon
        />
      ),
    },
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
        <NavMain items={data.navMain} />
        <NavDocuments items={data.documents} />
        <NavSecondary items={data.navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
