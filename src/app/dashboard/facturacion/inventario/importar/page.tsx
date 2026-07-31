import Link from "next/link"
import { ArrowLeft, FileSpreadsheet } from "lucide-react"

import { Button } from "@/components/ui/button"
import { requireClinicPage } from "@/lib/facturacion/page-auth"

// Página diferida A PROPÓSITO — no es un placeholder olvidado.
//
// El wizard de importación del repo del cliente (ImportWizard) parsea el Excel con xlsx@0.18.5 en
// el SERVIDOR, y esa lib tiene prototype pollution + ReDoS sin fix en npm (SheetJS abandonó el
// registro). Portarlo haría alcanzable ese código para cualquier autenticado. La deuda está
// documentada en ESTADO.md; esta página existe para que el link del inventario no dé 404 y para
// que el motivo quede a la vista, no enterrado en un doc.
//
// Se habilita cuando se reemplace la lib (candidatos: exceljs, o la versión mantenida de SheetJS
// desde su CDN). El motor de importación (import/parse.ts, ingest.ts) ya está portado y probado —
// solo espera un parser seguro.

export const metadata = { title: "Importar inventario · Tuvetia" }
export const dynamic = "force-dynamic"

export default async function ImportarInventarioPage() {
  // Hoy la página es estática, pero es la ÚNICA de las 16 del módulo sin el guard — y una
  // invariante con excepciones deja de ser invariante: cualquier dato que se agregue mañana
  // nacería sin control de acceso por omisión.
  const ctx = await requireClinicPage()
  if (!ctx) return null
  return (
    <main className="min-w-0 flex-1">
      <div className="mx-auto w-full max-w-3xl px-[30px] pb-16 pt-7">
        <header className="mb-6">
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.022em] text-fg">
            Importar inventario
          </h1>
          <p className="mt-[3px] text-[13px] text-fg-muted">Catálogo y existencias desde Excel/CSV</p>
        </header>

        <div className="rounded-lg border border-line-soft bg-card p-8 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex size-11 items-center justify-center rounded-lg bg-secondary">
              <FileSpreadsheet className="size-5 text-fg" aria-hidden />
            </div>
            <div>
              <h2 className="text-lg font-medium text-fg">Disponible próximamente</h2>
              <p className="text-sm text-fg-faint">
                La importación desde Excel está temporalmente deshabilitada mientras reemplazamos la
                librería de lectura de planillas por una versión segura.
              </p>
            </div>
          </div>

          <p className="mt-6 text-sm text-fg-muted">
            Mientras tanto puedes cargar ítems uno a uno desde el <b>Catálogo</b> (con su IVA, costo
            y existencia inicial), o registrar entradas por <b>Compras</b> — el inventario se mueve
            solo con cada compra y cada factura.
          </p>

          <div className="mt-7 flex items-center gap-3">
            <Button render={<Link href="/dashboard/facturacion/catalogo" />}>Ir al catálogo</Button>
            <Button variant="outline" render={<Link href="/dashboard/facturacion/inventario" />}>
              <ArrowLeft aria-hidden />
              Volver al inventario
            </Button>
          </div>
        </div>
      </div>
    </main>
  )
}
