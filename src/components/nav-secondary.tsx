"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"

import { urlActivaEntre } from "@/lib/nav-active"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

// El bloque secundario del pie: Integraciones, Administración, Configuración, Ayuda.
//
// ── UNA FILA DE ICONOS, NO UNA PILA DE FILAS ──────────────────────────────────────────────────
//
// El pie de la barra está anclado (David lo pidió el 25-ago-AM y hay test que lo protege), y todo
// lo que mide el pie se lo resta al contenido de arriba. Apilados, estos cuatro ítems + el usuario
// costaban ~232 px — y en un portátil de 768 de alto eso dejaba al grupo «Consulta» (Athos, Modo
// Fantasma, Iniciar consulta) justo debajo del pliegue: «se pierde el Athos y el modo fantasma»
// (David, 25-ago-PM). Los dos pedidos del mismo día chocaban entre sí.
//
// La fila de iconos los reconcilia: el pie sigue anclado y pasa a costar ~90 px. Son cuatro
// destinos que se visitan una vez por semana — no necesitan su rótulo a la vista permanente; el
// tooltip lo dice al pasar, el `aria-label` lo dice al lector, y el activo se resalta igual.
//
// COLAPSADA EN MODO ICONO la fila vuelve a ser columna: ahí la barra mide 3rem y cuatro iconos en
// horizontal no caben — quedarían recortados, que es justo la clase de «una vaina esconde otra»
// que se está arreglando.

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
  // El desempate entre anidados (Administración contiene a Configuración) lo decide quien ve la
  // lista completa — ver `urlActivaEntre`.
  const activa = urlActivaEntre(pathname, items.map((i) => i.url))
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu className="flex-row justify-between group-data-[collapsible=icon]:flex-col">
          {items.map((item) => (
            <SidebarMenuItem key={item.title} className="flex-none">
              {/* `<Link>`, no `<a href>`: un ancla cruda a ruta interna recarga el documento y mata
                  la grabación en curso. La explicación completa está en `nav-main.tsx`. */}
              <SidebarMenuButton
                isActive={item.url === activa}
                tooltip={item.title}
                aria-label={item.title}
                render={<Link href={item.url} prefetch />}
                className="size-8 justify-center p-0"
              >
                {item.icon}
                {/* El rótulo vive en el tooltip y el aria-label: en fila no hay ancho para cuatro
                    palabras, y con él en pantalla la fila volvería a ser pila. */}
                <span className="sr-only">{item.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
