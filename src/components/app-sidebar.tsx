"use client"

import * as React from "react"

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
import { LayoutDashboardIcon, UsersIcon, ContactIcon, CalendarIcon, MessageCircleIcon, Settings2Icon, CircleHelpIcon, BotIcon, GhostIcon, CommandIcon } from "lucide-react"

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
      url: "#",
      icon: (
        <MessageCircleIcon
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
      name: "Copiloto",
      url: "/dashboard/asistente",
      icon: (
        <BotIcon
        />
      ),
    },
    {
      name: "Modo fantasma",
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
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: { name: string; email: string; avatar: string }
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
              <CommandIcon className="size-5!" />
              <span className="text-base font-semibold">TuvetIA</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
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
