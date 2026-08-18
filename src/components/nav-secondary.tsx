"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { isNavActive } from "@/lib/nav-active"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export function NavSecondary({
  items,
  ...props
}: {
  items: {
    title: string
    url: string
    icon: React.ReactNode
  }[]
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  const pathname = usePathname()
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {/* Estos dos ítems eran los únicos del sidebar sin `isActive` ni `tooltip`: Configuración
              y Ayuda nunca se resaltaban aunque estuvieras dentro, y colapsada la barra quedaban
              como dos iconos mudos mientras el resto sí decía su nombre al pasar el ratón. */}
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              {/* `<Link>`, no `<a href>`: un ancla cruda a ruta interna recarga el documento y mata
                  la grabación en curso. La explicación completa está en `nav-main.tsx`. */}
              <SidebarMenuButton
                isActive={isNavActive(pathname, item.url)}
                tooltip={item.title}
                render={<Link href={item.url} />}
              >
                {item.icon}
                <span>{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
