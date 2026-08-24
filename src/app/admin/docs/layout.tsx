import { BookOpenIcon } from "lucide-react"
import Link from "next/link"

import { BarraDeDocs, type EntradaDeDocs } from "@/components/docs/barra-de-docs"
import { arbol } from "@/lib/docs/catalogo"
import { requerirAdminDePlataforma } from "@/lib/platform-admin"

import "@/components/docs/docs.css"

// El marco de la documentación: barra lateral a la izquierda, documento a la derecha.
//
// VIVE BAJO `/admin` Y NO BAJO `/dashboard`, y no es un detalle de organización: `/dashboard` es el
// área de los CLIENTES —cualquier veterinario de cualquier clínica con sesión entra— y esta
// documentación describe la arquitectura, los servicios y los nombres de los secretos. Acá el gate
// es la allowlist `PLATFORM_ADMIN_EMAILS`, y quien no está en ella recibe un 404: el panel entero es
// invisible.
//
// EL ÁRBOL SE ARMA UNA VEZ, ACÁ. Un layout de App Router no se vuelve a renderizar al navegar entre
// sus páginas hijas, así que el catálogo se lee del disco una sola vez por sesión de navegación y no
// en cada documento que se abre. Ponerlo en la página habría releído ~90 archivos por clic.
//
// AL NAVEGADOR SÓLO VIAJA EL ÍNDICE —slug, título, sección, fecha— y nunca el cuerpo de los
// documentos. Son varios megabytes de Markdown entre todos; mandarlos para pintar una lista de
// enlaces sería pagar el sitio entero en cada carga.

export default async function DocsLayout({ children }: { children: React.ReactNode }) {
  // Igual que las páginas: este layout anidado también se renderiza en paralelo con el de
  // /admin, así que su gate no lo cubre. Acá se filtraría el índice entero de la documentación.
  await requerirAdminDePlataforma()

  const secciones = await arbol()
  const entradas: EntradaDeDocs[] = secciones.flatMap((s) =>
    s.documentos.map((d) => ({ slug: d.slug, titulo: d.titulo, seccion: d.seccion, fecha: d.fecha })),
  )

  return (
    <div className="flex min-w-0 flex-col gap-6 lg:flex-row lg:gap-8">
      {/* `lg:top-12` y no `top-0`: la cabecera del panel de admin mide 3rem y es fija en el flujo,
          así que un sticky pegado al borde superior quedaría tapado por ella.

          En móvil la barra se apila arriba con altura acotada — una lista de noventa enlaces antes
          del contenido es una pared. */}
      <aside className="w-full shrink-0 lg:sticky lg:top-12 lg:h-[calc(100svh-3rem)] lg:w-64">
        <Link
          href="/admin/docs"
          className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold text-fg"
        >
          <BookOpenIcon className="size-4 text-fg-faint" aria-hidden />
          Documentación
        </Link>
        <div className="max-h-[40svh] lg:max-h-[calc(100svh-6rem)]">
          <BarraDeDocs entradas={entradas} />
        </div>
      </aside>

      <div className="min-w-0 flex-1 pb-10">{children}</div>
    </div>
  )
}
