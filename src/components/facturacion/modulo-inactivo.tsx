import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { PageShell } from "@/components/ui/page-shell"

/**
 * Lo que se ve en una pantalla de Ventas cuando el módulo de facturación no está activo.
 *
 * ── POR QUÉ ES UN COMPONENTE Y NO OCHO COPIAS ──────────────────────────────────────────────────
 *
 * El aviso «El módulo no está activo · Configúralo primero» estaba escrito ocho veces, y en dos
 * formas distintas:
 *
 *   · CUATRO pantallas lo devuelven como return TEMPRANO —Productos y servicios, Existencias,
 *     Salidas y reservas, Ingresos y egresos— y con eso se llevaban por delante toda su cabecera:
 *     la flecha de volver vive en la rama activa, así que con el módulo apagado desaparecía. El vet
 *     quedaba en un `PageShell` con un título, un párrafo y un enlace a Configuración.
 *   · Las otras CUATRO —Compras, Nueva compra, Proveedores, Nueva venta— lo pintan DENTRO de la
 *     página, debajo de su cabecera, así que conservan la flecha. Ésas están bien y no usan esto.
 *
 * O sea que el defecto no era el texto repetido: era que la mitad de las copias perdía la salida.
 * Acá la flecha viene incluida, y ya no depende de que quien escriba la próxima pantalla se acuerde.
 *
 * ── LA SALIDA SON DOS, Y NO ES DE MÁS ──────────────────────────────────────────────────────────
 *
 * «Configúralo primero» es lo que hay que hacer, pero exige permisos y ganas. La flecha a Ventas es
 * para el que sólo quería volver — que es la mayoría de las veces que alguien aterriza acá por
 * error. Ofrecer únicamente la acción que resuelve el problema deja sin salida a quien no venía a
 * resolverlo.
 */
export function ModuloInactivo({
  titulo,
  /** Qué se puede hacer en esta pantalla cuando el módulo sí esté activo. Opcional. */
  detalle,
}: {
  titulo: string
  detalle?: string
}) {
  return (
    <PageShell>
      <Link
        href="/dashboard/facturacion"
        className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Ventas
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight text-fg">{titulo}</h1>
      {detalle && <p className="mt-1 text-sm text-fg-faint">{detalle}</p>}
      <p className="mt-4 rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm text-fg-muted">
        El módulo no está activo.{" "}
        <Link
          href="/dashboard/facturacion/configuracion"
          className="underline underline-offset-2"
        >
          Configúralo primero
        </Link>
        .
      </p>
    </PageShell>
  )
}
