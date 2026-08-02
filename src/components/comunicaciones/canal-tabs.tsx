"use client"

// Pestañas de canal (WhatsApp / Correo). Es cliente porque necesita saber en qué ruta está y este
// proyecto no tiene middleware que inyecte el pathname en los headers — `usePathname` lo resuelve
// sin agregar esa pieza solo para pintar un subrayado.

import { usePathname } from "next/navigation"

import { TabNav, TabNavLink } from "@/components/ui/tab-nav"

const CANALES = [
  { href: "/dashboard/comunicaciones", label: "WhatsApp" },
  { href: "/dashboard/comunicaciones/correo", label: "Correo" },
]

export function CanalTabs() {
  const pathname = usePathname()
  return (
    <TabNav>
      {CANALES.map((c) => (
        <TabNavLink
          key={c.href}
          href={c.href}
          // Comparación exacta: con `startsWith`, la pestaña de WhatsApp (que es el prefijo de
          // todas) quedaría marcada también estando en Correo.
          active={pathname === c.href}
        >
          {c.label}
        </TabNavLink>
      ))}
    </TabNav>
  )
}
