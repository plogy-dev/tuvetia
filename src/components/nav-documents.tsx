"use client"

import { usePathname } from "next/navigation"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavDocuments({
  items,
  label = "Copiloto clínico",
}: {
  items: {
    name: string
    url: string
    icon: React.ReactNode
  }[]
  /** Antes era la cadena "AI", en inglés y sin decir nada. */
  label?: string
}) {
  const pathname = usePathname()
  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const isActive =
            pathname === item.url || pathname.startsWith(item.url + "/")
          return (
            <SidebarMenuItem key={item.name}>
              <SidebarMenuButton
                isActive={isActive}
                tooltip={item.name}
                render={<a href={item.url} />}
              >
                {item.icon}
                <span>{item.name}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}
