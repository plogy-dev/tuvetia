import Link from "next/link"
import { ArrowLeft, Info } from "lucide-react"

import { ImportadorCsv } from "@/components/facturacion/ImportadorCsv"
import { requireClinicPage } from "@/lib/facturacion/page-auth"

// Importar inventario — POR CSV.
//
// Esta página era un "disponible próximamente" que explicaba por qué no se podía importar:
// `xlsx@0.18.5` tiene prototype pollution + ReDoS sin fix en npm, y la guarda de
// `createImportPreview` bloqueaba la action entera.
//
// LO QUE CAMBIÓ NO ES LA DEUDA, ES SU ALCANCE. `parseInventoryFile` sólo llama a xlsx cuando el
// archivo termina en `.xlsx`/`.xls`; el camino del CSV es Papaparse, que no tiene nada que ver con
// esas CVE. Se estaba bloqueando un parser sano para tapar a otro. La guarda pasó a cortar por
// extensión —antes de la sesión y antes de leer un byte— así que `XLSX.read` sigue siendo
// inalcanzable, y el CSV vuelve a ser un camino completo.
//
// El motor (parse → mapeo → validación → commit → revert) ya estaba portado y probado desde hacía
// semanas; lo único que faltaba era una pantalla que lo usara.
//
// SE HABILITA EL .XLSX cuando se reemplace la librería (candidatos: exceljs, o el SheetJS mantenido
// de su CDN): es editar la constante de `createImportPreview` y el `accept` del input.

export const metadata = { title: "Importar catálogo · Tuvetia" }
export const dynamic = "force-dynamic"

export default async function ImportarInventarioPage() {
  // Hoy la página no trae datos, pero es la ÚNICA de las 16 del módulo sin el guard — y una
  // invariante con excepciones deja de ser invariante: cualquier dato que se agregue mañana
  // nacería sin control de acceso por omisión.
  const ctx = await requireClinicPage()
  if (!ctx) return null

  return (
    <section className="min-w-0 flex-1">
      <div className="mx-auto w-full max-w-3xl px-[30px] pb-16 pt-7">
        <header className="mb-6">
          <Link
            href="/dashboard/facturacion"
            className="mb-3 inline-flex items-center gap-1 text-xs text-fg-faint hover:text-fg"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            Ventas
          </Link>
          <h1 className="font-display text-[26px] font-semibold leading-[1.15] tracking-[-0.022em] text-fg">
            Importar catálogo
          </h1>
          <p className="mt-[3px] text-[13px] text-fg-muted">
            Catálogo y existencias desde una planilla en CSV
          </p>
        </header>

        <ImportadorCsv />

        {/* SE DICE POR QUÉ FALTA EL .XLSX, y no se deja como un límite arbitrario. Un "sólo CSV" sin
            explicación se lee como una app a medio hacer; el motivo real —una librería con una
            vulnerabilidad sin parche— se lee como criterio. Y de paso deja escrito para el próximo
            que pase por acá qué hay que hacer para levantarlo. */}
        <p className="mt-6 flex items-start gap-2 rounded-lg border border-line-soft bg-surface-2 px-4 py-3 text-[13px] text-fg-muted">
          <Info className="mt-px size-4 shrink-0 text-fg-faint" aria-hidden />
          <span>
            Todavía no aceptamos <b>.xlsx</b> ni <b>.xls</b>: la librería que los lee tiene una
            vulnerabilidad sin parche publicado y preferimos no exponerla. Guardá la planilla como{" "}
            <b>CSV</b> desde Excel y entra igual — o cargá el catálogo con una foto desde{" "}
            <Link href="/dashboard/facturacion/catalogo" className="underline underline-offset-2">
              Catálogo
            </Link>
            .
          </span>
        </p>
      </div>
    </section>
  )
}
