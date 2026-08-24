"use client"

// Las secciones de la zona de ventas, en un menú.
//
// ── POR QUÉ DEJARON DE SER BOTONES ────────────────────────────────────────────────────────────
//
// La cabecera de Ventas tenía SEIS botones en fila —Finanzas, Cartera, Inventario, Catálogo,
// Configuración y Nueva factura— y cinco de ellos no son acciones: son DESTINOS. Puestos con el
// mismo peso que la única acción real, lo primero que ve alguien que entra a cobrar una consulta es
// una pared de seis opciones, y la que necesita es la última.
//
// Reportado por un vet el 24-ago probando facturación en producción: «super confuso».
//
// La referencia lo resuelve igual: en OkVet la zona de ventas cuelga de un menú desplegable
// —Dashboard de ventas, Cotizaciones, Ventas/recibos/facturas, Productos y servicios, Categorías,
// Salidas y reservas, Configuración— y en la pantalla queda UNA sola acción destacada, «Registrar
// venta». Se miró su producto con la cuenta del cliente el 24-ago; hasta entonces el repo trabajaba
// a ciegas porque OkVet no publica capturas.
//
// NO SE ESCONDE NADA. Un menú con etiqueta visible («Secciones») y siete entradas es más
// descubrible que seis botones que compiten: el que busca Inventario lo encuentra igual, y el que
// viene a facturar ya no tiene que leerlos todos para llegar al que le sirve.

import Link from "next/link"
import { BookOpen, Boxes, ChevronDown, MailWarning, Settings2, Wallet } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const SECCIONES = [
  { href: "/dashboard/facturacion/finanzas", label: "Finanzas", Icono: Wallet },
  { href: "/dashboard/facturacion/cartera", label: "Cartera", Icono: MailWarning },
  { href: "/dashboard/facturacion/inventario", label: "Inventario", Icono: Boxes },
  { href: "/dashboard/facturacion/catalogo", label: "Catálogo", Icono: BookOpen },
  { href: "/dashboard/facturacion/configuracion", label: "Configuración", Icono: Settings2 },
] as const

export function MenuDeVentas() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Secciones
        <ChevronDown className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {SECCIONES.map(({ href, label, Icono }) => (
          <DropdownMenuItem key={href} render={<Link href={href} />}>
            <Icono className="size-4" aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
