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

// El bloque secundario: Integraciones, Administración, Configuración, Ayuda.
//
// ── DÓNDE VIVE, Y POR QUÉ CAMBIÓ DOS VECES ────────────────────────────────────────────────────
//
// 25-ago: David lo mandó al pie anclado. 26-ago: David lo mandó de vuelta al contenido —«ese
// sticky donde está el escudo, el enchufe de conexiones y el símbolo de pregunta, que también
// baje». Hoy vive dentro de `SidebarContent` (ver `app-sidebar.tsx`, que explica por qué la razón
// del ancla dejó de aplicar).
//
// ── UNA FILA DE ICONOS, NO UNA PILA DE FILAS ──────────────────────────────────────────────────
//
// Esto sobrevive a los dos cambios de sitio porque nunca fue por el pie, fue por el alto.
// Apilados, estos cuatro ítems costaban ~232 px, y en un portátil de 768 eso dejaba al grupo
// «Consulta» (Athos, Modo Fantasma, Iniciar consulta) justo debajo del pliegue: «se pierde el
// Athos y el modo fantasma» (David, 25-ago-PM). En fila cuestan ~90.
//
// Son cuatro destinos que se visitan una vez por semana — no necesitan su rótulo a la vista
// permanente; el tooltip lo dice al pasar, el `aria-label` lo dice al lector, y el activo se
// resalta igual.
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
        {/* COLAPSADA: columna CENTRADA. Sin `items-center` los iconos se alineaban al borde
            izquierdo del riel mientras el resto de la barra los centra — cuatro iconos corridos
            medio centímetro respecto de los diez de arriba, que es la mitad del "mal aspecto".
            Y `gap-1`: `justify-between` no separa nada en una columna sin alto fijo, así que sin
            él quedaban pegados de a cuatro. */}
        <SidebarMenu className="flex-row justify-between group-data-[collapsible=icon]:flex-col group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:gap-1">
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
