import Link from "next/link"

import { PageHeader } from "@/components/ui/page-shell"
import { requerirAdminDePlataforma } from "@/lib/platform-admin"
import { arbol, catalogo } from "@/lib/docs/catalogo"
import {
  buscar,
  DESCRIPCION_DE_SECCION,
  SECCIONES_DIATAXIS,
  TITULO_DE_SECCION,
} from "@/lib/docs/documento"

export const metadata = { title: "Documentación · Tuvetia" }

// El índice de la documentación, y el resultado de la búsqueda por contenido.
//
// SON LA MISMA PÁGINA a propósito. Con `?q=` se listan coincidencias; sin él, el mapa completo. Una
// ruta aparte para los resultados obligaría a mantener dos veces el mismo listado de tarjetas y a
// decidir a cuál vuelve el botón de atrás.

export default async function DocsIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  // LA GUARDA VA PRIMERO, ANTES DE LEER NADA DEL DISCO.
  //
  // El layout de /admin ya comprueba el permiso, y no alcanza: en el App Router el layout y la
  // página se renderizan EN PARALELO, así que su `notFound()` corta la pantalla pero esta página
  // ya corrió y sus datos quedan serializados en la respuesta. Es exactamente el incidente del
  // 24-ago (#208), y acá lo que se filtraría es la documentación de los secretos y la
  // arquitectura dentro del cuerpo de un 404.
  await requerirAdminDePlataforma()

  const { q } = await searchParams
  const consulta = (q ?? "").trim()

  if (consulta) {
    const resultados = buscar(await catalogo(), consulta)
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <PageHeader
          title="Buscar en la documentación"
          description={
            resultados.length === 0
              ? `Sin coincidencias para «${consulta}».`
              : `${resultados.length} ${resultados.length === 1 ? "documento menciona" : "documentos mencionan"} «${consulta}».`
          }
        />
        <ul className="flex flex-col gap-2">
          {resultados.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/admin/docs/${d.slug}`}
                className="block rounded-xl border border-line bg-card p-4 transition-colors hover:border-line-strong"
              >
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-fg">{d.titulo}</span>
                  <span className="text-[11px] tracking-[0.08em] text-fg-faint uppercase">
                    {TITULO_DE_SECCION[d.seccion]}
                  </span>
                </div>
                {d.resumen && <p className="mt-1 text-[13px] text-fg-muted">{d.resumen}</p>}
                <p className="mt-1.5 font-mono text-[11px] text-fg-faint">{d.archivo}</p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const secciones = await arbol()
  const total = secciones.reduce((n, s) => n + s.documentos.length, 0)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <PageHeader
        title="Documentación de Tuvetia"
        description={`${total} documentos. Cada uno es un archivo Markdown del repositorio: se edita donde vive, con git, y acá se lee.`}
      />

      {/* LAS CUATRO PRIMERAS SON DIÁTAXIS y se explican, porque la división no es obvia y es lo que
          hace que un manual se pueda leer: quien aprende no quiere una tabla de variables, y quien
          busca una variable no quiere un tutorial. */}
      {secciones.map(({ seccion, documentos }) => (
        <section key={seccion} className="flex flex-col gap-2">
          <div>
            <h2 className="font-display text-xl font-medium tracking-[-0.01em] text-fg">
              {TITULO_DE_SECCION[seccion]}
              {!SECCIONES_DIATAXIS.includes(seccion) && (
                <span className="ml-2 font-mono text-[11px] text-fg-faint tabular-nums">
                  {documentos.length}
                </span>
              )}
            </h2>
            <p className="text-[13px] text-fg-muted">{DESCRIPCION_DE_SECCION[seccion]}</p>
          </div>

          <ul className="grid gap-2 sm:grid-cols-2">
            {documentos.map((d) => (
              <li key={d.slug}>
                <Link
                  href={`/admin/docs/${d.slug}`}
                  className="flex h-full flex-col rounded-xl border border-line bg-card p-3.5 transition-colors hover:border-line-strong"
                >
                  <span className="text-[14px] leading-snug font-medium text-fg">{d.titulo}</span>
                  {d.resumen && (
                    <span className="mt-1 text-[12.5px] leading-snug text-fg-muted">{d.resumen}</span>
                  )}
                  {d.fecha && !d.resumen && (
                    <span className="mt-1 font-mono text-[11px] text-fg-faint tabular-nums">
                      {d.fecha}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
