"use client"

// Las secciones de la zona de ventas, con la estructura y los nombres de OkVet.
//
// ── UNA CORRECCIÓN, PORQUE LA PRIMERA LECTURA FUE MALA ────────────────────────────────────────
//
// El 24-ago se miró OkVet y se concluyó que «no tiene menú de secciones»: su `···`, al lado de
// «Registrar venta», sólo trae «Unificador de cuentas». Eso es cierto y era la conclusión
// equivocada — el menú de ventas de OkVet SÍ existe, cuelga de su PESTAÑA «Ventas» en la barra de
// navegación, y tiene DOS NIVELES con doce entradas:
//
//   Dashboard de ventas · Documentos ▸ (Cotizaciones · Ventas, recibos y facturas · Notas crédito ·
//   Documentos soporte) · Ingresos y Egresos · Inventario ▸ (Productos y servicios · Categorías ·
//   Salidas y reservas · Ordenes de compra · Compras) · Proveedores · Clientes · Crédito Welli ·
//   Configuración de facturación
//
// O sea que el problema nunca fue que el menú sobrara: era que se quedaba corto.
//
// ── LO QUE ESTABA CONSTRUIDO Y CASI NO TENÍA PUERTA ───────────────────────────────────────────
//
// Este menú mostraba CINCO destinos. La zona de ventas tiene nueve pantallas, y cuatro sólo se
// alcanzaban entrando primero a Inventario y buscando un enlace adentro:
//
//   · Compras            — lista, nueva, editar y detalle, todo hecho
//   · Proveedores        — sólo enlazado desde dentro de Compras
//   · Salidas y reservas — los movimientos de inventario
//   · Importar catálogo
//
// Nadie las iba a encontrar. Un vet que quiere registrar una compra no adivina que el camino es
// Ventas → Secciones → Inventario → Compras.
//
// ── Y LOS NOMBRES NO COINCIDÍAN NI CON NOSOTROS MISMOS ────────────────────────────────────────
//
// El menú decía «Finanzas» y esa página se titula, en su propio `h1`, «Ingresos y egresos» — que
// resulta ser el nombre exacto que usa OkVet. Se adoptan sus etiquetas donde hay equivalente:
// «Productos y servicios» en vez de «Catálogo», «Salidas y reservas» en vez de «Movimientos»,
// «Configuración de facturación» en vez de «Configuración». El motivo es el de siempre con esta
// referencia: los veterinarios ya saben usar OkVet, y cada palabra distinta es una que reaprenden.
//
// ── LO QUE NO SE COPIA, DICHO ─────────────────────────────────────────────────────────────────
//
// No están Cotizaciones, Documentos soporte, Órdenes de compra ni Crédito Welli: no existen acá y
// una entrada que lleva a una pantalla vacía es peor que su ausencia. «Cartera» sí está y es
// nuestra — OkVet no tiene equivalente.
//
// Este menú sigue viviendo en la cabecera y no en la barra lateral, que es donde estaría la copia
// fiel. Subirlo toca el orden que definió Luciano el 19-ago y es una decisión de Felipe, no de este
// archivo.

import Link from "next/link"
import {
  BookOpen,
  Boxes,
  ChevronDown,
  FileText,
  MailWarning,
  Package,
  Receipt,
  Settings2,
  ShoppingCart,
  Truck,
  Upload,
  Wallet,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"

/** Los documentos de venta. En OkVet es un submenú; acá son dos, así que van sueltos con su rótulo. */
const DOCUMENTOS = [
  {
    href: "/dashboard/facturacion",
    label: "Ventas, recibos y facturas",
    Icono: Receipt,
  },
  { href: "/dashboard/facturacion/cartera", label: "Cartera", Icono: MailWarning },
] as const

/** Inventario, con las etiquetas de la referencia. */
const INVENTARIO = [
  {
    href: "/dashboard/facturacion/catalogo",
    label: "Productos y servicios",
    Icono: BookOpen,
  },
  { href: "/dashboard/facturacion/inventario", label: "Existencias", Icono: Package },
  {
    href: "/dashboard/facturacion/inventario/movimientos",
    label: "Salidas y reservas",
    Icono: Boxes,
  },
  { href: "/dashboard/facturacion/compras", label: "Compras", Icono: ShoppingCart },
  {
    href: "/dashboard/facturacion/inventario/importar",
    label: "Importar catálogo",
    Icono: Upload,
  },
] as const

/** Lo que en OkVet cuelga directo de «Ventas». */
const SUELTOS = [
  {
    href: "/dashboard/facturacion/finanzas",
    label: "Ingresos y egresos",
    Icono: Wallet,
  },
  {
    href: "/dashboard/facturacion/compras/proveedores",
    label: "Proveedores",
    Icono: Truck,
  },
  {
    href: "/dashboard/facturacion/configuracion",
    label: "Configuración de facturación",
    Icono: Settings2,
  },
] as const

export function MenuDeVentas() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" />}>
        Secciones
        <ChevronDown className="size-4" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel className="flex items-center gap-2">
          <FileText className="size-3.5 text-fg-faint" aria-hidden />
          Documentos
        </DropdownMenuLabel>
        {DOCUMENTOS.map(({ href, label, Icono }) => (
          <DropdownMenuItem key={href} render={<Link href={href} />}>
            <Icono className="size-4" aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {/* Inventario va en submenú, como en la referencia: son cinco pantallas y sueltas
            duplicarían el largo del menú. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Boxes className="size-4" aria-hidden />
            Inventario
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-56">
            {INVENTARIO.map(({ href, label, Icono }) => (
              <DropdownMenuItem key={href} render={<Link href={href} />}>
                <Icono className="size-4" aria-hidden />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        {SUELTOS.map(({ href, label, Icono }) => (
          <DropdownMenuItem key={href} render={<Link href={href} />}>
            <Icono className="size-4" aria-hidden />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
