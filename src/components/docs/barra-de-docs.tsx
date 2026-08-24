"use client"

// La barra lateral de la documentación: el árbol completo y el buscador.
//
// ── POR QUÉ EL BUSCADOR FILTRA EN EL CLIENTE ────────────────────────────────────────────────────
//
// Son ~90 documentos y lo que viaja es su título, su resumen y su sección — no el cuerpo. Filtrar
// eso en memoria es instantáneo y no cuesta una petición por tecla, que es lo que haría un buscador
// servidor con un campo que se escribe letra a letra.
//
// LA BÚSQUEDA POR CONTENIDO ES OTRA COSA y vive en el servidor (`/admin/docs?q=`): ahí sí se
// mira el cuerpo de cada documento, que es donde está casi todo lo que alguien viene a buscar —el
// nombre de una variable de entorno, una tabla, el número de una migración. Este campo ofrece las
// dos: filtra la lista al instante y, con Enter, manda a la búsqueda completa.

import { useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { SearchIcon } from "lucide-react"

import { Input } from "@/components/ui/input"
import { normalizar, TITULO_DE_SECCION, type Seccion } from "@/lib/docs/documento"

/** Lo mínimo del documento que hace falta para listarlo. El cuerpo NO viaja al navegador. */
export type EntradaDeDocs = {
  slug: string
  titulo: string
  seccion: Seccion
  fecha: string | null
}

export function BarraDeDocs({ entradas }: { entradas: EntradaDeDocs[] }) {
  const router = useRouter()
  const [filtro, setFiltro] = useState("")
  // CUÁL ESTÁ ABIERTO SALE DE LA URL Y NO DE UNA PROP. La barra vive en el layout, y un layout de
  // App Router no se vuelve a renderizar al navegar entre sus páginas hijas: una prop quedaría
  // congelada en el primer documento que se abrió y el resaltado no se movería nunca más.
  const slugActivo = usePathname().replace(/^\/admin\/docs\/?/, "") || null

  const grupos = useMemo(() => {
    const q = normalizar(filtro)
    const visibles = q ? entradas.filter((e) => normalizar(e.titulo).includes(q)) : entradas
    const porSeccion = new Map<Seccion, EntradaDeDocs[]>()
    for (const e of visibles) {
      const lista = porSeccion.get(e.seccion) ?? []
      lista.push(e)
      porSeccion.set(e.seccion, lista)
    }
    return [...porSeccion.entries()]
  }, [entradas, filtro])

  return (
    <nav aria-label="Documentación" className="flex h-full flex-col gap-3">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const q = filtro.trim()
          if (q) router.push(`/admin/docs?q=${encodeURIComponent(q)}`)
        }}
        className="relative"
      >
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-faint"
          aria-hidden
        />
        <Input
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar…"
          aria-label="Buscar en la documentación"
          className="pl-8"
        />
      </form>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {grupos.length === 0 && (
          <p className="px-2 py-4 text-[13px] text-fg-muted">
            Ningún título coincide. Apretá Enter para buscar también dentro del texto.
          </p>
        )}

        {grupos.map(([seccion, docs]) => (
          <div key={seccion} className="mb-4">
            <h2 className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-faint uppercase">
              {TITULO_DE_SECCION[seccion]}
              <span className="ml-1.5 font-mono tabular-nums normal-case">{docs.length}</span>
            </h2>
            <ul className="flex flex-col">
              {docs.map((d) => (
                <li key={d.slug}>
                  <Link
                    href={`/admin/docs/${d.slug}`}
                    aria-current={d.slug === slugActivo ? "page" : undefined}
                    className={`block rounded-md px-2 py-1.5 text-[13px] leading-snug transition-colors ${
                      d.slug === slugActivo
                        ? "bg-brand-soft font-medium text-brand-text"
                        : "text-fg-muted hover:bg-accent/50 hover:text-fg"
                    }`}
                  >
                    {d.titulo}
                    {/* La fecha se dice en la lista del histórico y sólo ahí: es el dato que
                        distingue una foto de otra, y sin él "REVIEW" aparece tres veces igual. */}
                    {seccion === "historico" && d.fecha && (
                      <span className="ml-1.5 font-mono text-[11px] text-fg-faint tabular-nums">
                        {d.fecha}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}
