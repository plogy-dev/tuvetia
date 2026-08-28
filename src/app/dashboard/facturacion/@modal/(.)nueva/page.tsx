// «Registrar venta», sin salir del libro de ventas.
//
// Esto INTERCEPTA `/dashboard/facturacion/nueva` cuando se llega navegando desde la zona de ventas
// y lo pinta dentro de un modal. Quien pegue la URL, recargue o la comparta cae en la página
// completa de siempre (`nueva/page.tsx`), que es lo que hace útil este patrón frente a un modal de
// estado: la cuenta a medio armar sobrevive a un F5.
//
// SE REUSA LA MISMA PÁGINA, no una copia. El contenido de «Nueva cuenta» son 350 líneas con dos
// pasos, búsqueda de titulares y el cruce con lo recetado en la consulta: duplicarlo para el modal
// habría garantizado que las dos versiones se separaran en la primera corrección que sólo alguien
// aplicara a una. Lo único que cambia es `enModal`, que le dice a la página que suelte su propio
// marco porque el modal ya trae el suyo.

import NuevaFacturaPage from "../../nueva/page"
import { ModalDeVenta } from "@/components/facturacion/ModalDeVenta"

export const dynamic = "force-dynamic"

export default function ModalNuevaVenta({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  return (
    <ModalDeVenta titulo="Nueva cuenta">
      <NuevaFacturaPage searchParams={searchParams} enModal />
    </ModalDeVenta>
  )
}
