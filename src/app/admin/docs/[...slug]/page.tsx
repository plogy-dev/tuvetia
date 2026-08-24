import { notFound } from "next/navigation"

import { Markdown } from "@/components/docs/markdown"
import { PageHeader } from "@/components/ui/page-shell"
import { requerirAdminDePlataforma } from "@/lib/platform-admin"
import { catalogo, documentoPorSlug } from "@/lib/docs/catalogo"
import { TITULO_DE_SECCION } from "@/lib/docs/documento"

// Un documento. El slug es un catch-all porque las rutas tienen profundidad variable:
// `referencia/secretos` y `docs/entrega/readme` conviven, y los `.md` del repo conservan su carpeta
// para que tres `README.md` distintos no colapsen en el mismo slug.

export async function generateMetadata({ params }: { params: Promise<{ slug: string[] }> }) {
  const doc = await documentoPorSlug((await params).slug.join("/"))
  return { title: doc ? `${doc.titulo} · Documentación` : "Documentación · Tuvetia" }
}

export default async function DocumentoPage({ params }: { params: Promise<{ slug: string[] }> }) {
  // LA GUARDA VA PRIMERO, ANTES DE LEER NADA DEL DISCO.
  //
  // El layout de /admin ya comprueba el permiso, y no alcanza: en el App Router el layout y la
  // página se renderizan EN PARALELO, así que su `notFound()` corta la pantalla pero esta página
  // ya corrió y sus datos quedan serializados en la respuesta. Es exactamente el incidente del
  // 24-ago (#208), y acá lo que se filtraría es la documentación de los secretos y la
  // arquitectura dentro del cuerpo de un 404.
  await requerirAdminDePlataforma()

  const slug = (await params).slug.join("/")
  const doc = await documentoPorSlug(slug)
  if (!doc) notFound()

  // Los slugs de TODO el catálogo, para que el render pueda reescribir los enlaces entre archivos
  // (`[la agenda](CALENDARIO.md)`) a rutas de este sitio. Sin esto cada enlace cruzado sería un 404.
  const slugs = new Set((await catalogo()).map((d) => d.slug))

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title={doc.titulo}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[11px] tracking-[0.08em] text-fg-faint uppercase">
              {TITULO_DE_SECCION[doc.seccion]}
            </span>
            {/* LA RUTA DEL ARCHIVO SE DICE SIEMPRE, y es la línea más útil de la página: esto no es
                un CMS — el documento es un archivo del repo, y quien encuentre algo mal tiene que
                saber cuál abrir para arreglarlo. */}
            <code className="font-mono text-[11.5px] text-fg-muted">{doc.archivo}</code>
          </span>
        }
      />

      {doc.seccion === "historico" && (
        <div className="rounded-lg border border-warn/40 bg-warn-soft p-3.5 text-[13px] text-fg">
          <b>Esto es una foto{doc.fecha ? ` del ${doc.fecha}` : ""}, no la referencia vigente.</b>{" "}
          Describe cómo estaba el sistema ese día y se conserva como registro: varias de sus
          afirmaciones dejaron de ser ciertas a propósito, porque lo que señalaba se arregló después.
          Para el estado de hoy, mirá <b>Referencia</b>.
        </div>
      )}

      {doc.resumen && <p className="-mt-2 text-[15px] text-fg-muted">{doc.resumen}</p>}

      <article>
        <Markdown contenido={doc.contenido} slugs={slugs} slugActual={doc.slug} />
      </article>
    </div>
  )
}
