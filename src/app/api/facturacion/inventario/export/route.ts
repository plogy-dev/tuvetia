// Bajar el inventario a Excel.
//
// ES UNA RUTA Y NO UNA SERVER ACTION porque el resultado es un ARCHIVO. Una action devuelve datos a
// React; para que el navegador ofrezca "Guardar como" hace falta una respuesta con
// `Content-Disposition`, y eso es una ruta. Además así el botón es un `<a href>` común: funciona
// con click derecho, se puede abrir en otra pestaña, y no necesita JavaScript para descargar.
//
// CON EL CLIENTE DEL USUARIO, NO CON `service_role`. La RLS es la que garantiza que lo que baja es
// el inventario de SU clínica y nada más. Una exportación con service_role sería la forma más
// rápida de que un vet se lleve el catálogo de otra veterinaria por un `clinicId` mal pasado.

import { bogotaTodayISO } from "@/lib/date-utils"
import {
  libroDeInventario,
  nombreDelArchivo,
  type ItemExportable,
} from "@/lib/facturacion/export/inventario"
import { getStockMap, listCategories, listCatalogItems } from "@/lib/facturacion/queries"
import { requireClinicPage } from "@/lib/facturacion/page-auth"

export async function GET() {
  const ctx = await requireClinicPage()
  if (!ctx) return new Response("No autenticado", { status: 401 })
  const { supabase, clinicId } = ctx

  // SE EXPORTA TAMBIÉN LO INACTIVO. Un producto dado de baja sigue siendo parte del inventario que
  // la clínica quiere revisar —y si alguien exporta para corregir precios y volver a subir, que
  // desaparezcan los inactivos sin decir nada sería peor que incluirlos.
  const [items, categorias] = await Promise.all([
    listCatalogItems(supabase, clinicId, { includeInactive: true }),
    listCategories(supabase, clinicId, { includeArchived: true }),
  ])

  const conStock = items.filter((i) => i.track_stock).map((i) => i.id)
  const stock = await getStockMap(supabase, clinicId, conStock)

  const { data: clinica } = await supabase.from("clinics").select("name").maybeSingle()

  const buffer = libroDeInventario(items as unknown as ItemExportable[], {
    stock,
    categorias: new Map(categorias.map((c) => [c.id, c.name])),
  })

  const nombre = nombreDelArchivo((clinica as { name: string | null } | null)?.name, bogotaTodayISO())

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      // `filename*` en UTF-8 además del `filename` simple: el nombre de la clínica ya viene sin
      // acentos, pero un header con bytes altos rompe la descarga en vez de degradar el nombre.
      "Content-Disposition": `attachment; filename="${nombre}"; filename*=UTF-8''${encodeURIComponent(nombre)}`,
      // Un inventario cambia todo el día: servir el de hace una hora desde una caché intermedia
      // sería exportar datos viejos sin ninguna señal de que lo son.
      "Cache-Control": "no-store",
    },
  })
}
