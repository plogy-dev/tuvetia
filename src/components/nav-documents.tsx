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
    // Este grupo NO se oculta al colapsar. El `group-data-[collapsible=icon]:hidden` que traía
    // venía del grupo "Documents" de la plantilla `dashboard-01`, donde era una lista secundaria;
    // acá contiene Athos y el Modo Fantasma, que son lo primero del producto. Colapsado se
    // quedaban sin siquiera el icono. `SidebarGroupLabel` ya se desvanece solo en modo icono, y
    // cada botón tiene `tooltip`, así que en la barra angosta quedan los dos iconos con su nombre
    // al pasar el ratón — que es justo lo que el modo icono promete.
    <SidebarGroup>
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
