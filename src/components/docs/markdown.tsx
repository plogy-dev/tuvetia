// El renderizador de Markdown de la documentación.
//
// SIN "use client": corre en el servidor. Los `.md` se leen del disco en el server component y se
// pintan ahí mismo, así que el HTML llega hecho y no viaja ni el markdown crudo ni el parser al
// navegador. En un sitio de ~90 documentos, algunos largos, eso es la diferencia entre una página
// que abre al instante y una que descarga un parser para mostrar texto.
//
// ── POR QUÉ `react-markdown` Y NO EL RENDER QUE YA HABÍA ────────────────────────────────────────
//
// `components/athos/rich-text.tsx` pinta las respuestas de Athos, pero sólo resuelve negritas y
// marcadores de cita: es un render de UNA línea de texto. La documentación necesita encabezados,
// tablas, listas anidadas, bloques de código y enlaces — y escribir eso a mano es escribir un
// parser de Markdown, que es exactamente el trabajo que no hay que rehacer.
//
// `remark-gfm` va porque los archivos del repo ya usan tablas y listas de tareas, que no son
// Markdown básico sino GitHub Flavored. Sin él, media documentación se vería como texto plano con
// tuberías.

import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

/**
 * Los enlaces ENTRE documentos se reescriben.
 *
 * Los `.md` del repo se enlazan entre ellos como archivos —`[la agenda](CALENDARIO.md)`,
 * `[el esquema](./docs/SEGURIDAD-DB.md)`— porque están escritos para leerse en GitHub o en un
 * editor. Servidos tal cual, esos enlaces apuntarían a rutas que no existen en la app y cada uno
 * sería un 404.
 *
 * Se traducen al slug del sitio. Un enlace a un documento que el catálogo no conoce se deja como
 * está: es mejor un enlace roto y visible que uno reescrito a una página en blanco.
 */
function hrefDeDocumento(href: string, slugs: ReadonlySet<string>, slugActual: string): string | null {
  if (!href.toLowerCase().endsWith(".md")) return null

  const base = slugActual.split("/").slice(0, -1)
  const partes = href.replace(/\.md$/i, "").split("/")
  const pila: string[] = [...base]
  for (const parte of partes) {
    if (parte === "." || parte === "") continue
    if (parte === "..") pila.pop()
    else pila.push(parte)
  }
  const candidato = pila
    .join("/")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")

  // Se prueba el slug relativo al documento actual y, si no, el mismo href tomado desde la raíz del
  // repo. Los dos estilos conviven en los archivos que ya existían.
  const desdeRaiz = partes.join("/").toLowerCase()
  for (const s of [candidato, desdeRaiz]) {
    if (slugs.has(s)) return `/admin/docs/${s}`
  }
  return null
}

export function Markdown({
  contenido,
  slugs,
  slugActual,
}: {
  contenido: string
  /** Todos los slugs del catálogo, para poder reescribir los enlaces entre documentos. */
  slugs: ReadonlySet<string>
  slugActual: string
}) {
  return (
    <div className="docs-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // TODO LO INTERNO VA POR `<Link>`, sin excepción.
          //
          // No es estilo: un `<a href>` a una ruta de la app NO navega por el cliente, descarga el
          // documento de nuevo — y con él mueren el MediaRecorder y la sesión de `consulta-viva`.
          // Alguien puede estar leyendo la documentación con una consulta grabándose de fondo.
          //
          // El markdown de los `.md` del repo trae de todo: enlaces a otros documentos, rutas
          // relativas que no son `.md`, anclas y URLs externas. Sólo las que llevan un ESQUEMA
          // (`https:`, `mailto:`, `tel:`) salen de la app; el resto es navegación interna.
          a({ href, children }) {
            const crudo = href ?? ""
            const destino = hrefDeDocumento(crudo, slugs, slugActual) ?? crudo
            const clase = "text-brand-text underline underline-offset-2"

            // `//otro-sitio.com` también cuenta: el navegador lo lee como protocolo relativo.
            if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(destino)) {
              return (
                <a href={destino} className={clase} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              )
            }
            return (
              <Link href={destino || "#"} className={clase}>
                {children}
              </Link>
            )
          },
          // Las tablas se envuelven en su propio scroll: la referencia de secretos tiene cuatro
          // columnas y en un portátil desbordaría la página entera hacia el costado.
          table({ children }) {
            return (
              <div className="my-5 overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-[13px]">{children}</table>
              </div>
            )
          },
        }}
      >
        {contenido}
      </ReactMarkdown>
    </div>
  )
}
