import "server-only"

// Leer los `.md` del repo y armar el catálogo. La REGLA de cómo se clasifican vive en
// `documento.ts`, que es puro y está probado; acá está sólo el disco.
//
// ── POR QUÉ SE LEEN DEL DISCO Y NO SE IMPORTAN ──────────────────────────────────────────────────
//
// Porque los archivos tienen que seguir siendo la fuente de verdad y editarse donde están. Un paso
// de compilación que los copiara a un módulo generado crearía dos copias, y la segunda quedaría
// vieja el día que alguien edite la primera y no corra el script.
//
// ── LO QUE ESO OBLIGA A HACER EN EL DESPLIEGUE ──────────────────────────────────────────────────
//
// Vercel no sube el repo entero: sube lo que el rastreo de dependencias de Next encuentra a partir
// de los imports. Un `readFile` con una ruta armada en tiempo de ejecución es invisible para ese
// rastreo, así que los `.md` NO viajarían y la documentación saldría vacía en producción — sin
// fallar, que es lo peor.
//
// `outputFileTracingIncludes` en `next.config.ts` es lo que los mete a la fuerza. Si algún día se
// agrega documentación en una carpeta nueva, hay que sumarla ahí además de acá.

import { readFile, readdir } from "node:fs/promises"
import { join, relative, sep } from "node:path"
import { cache } from "react"

import {
  agruparPorSeccion,
  fechaEnElNombre,
  seccionDe,
  separarFrontmatter,
  slugDe,
  tituloDe,
  type Documento,
  type Seccion,
} from "./documento"

/**
 * Dónde se busca. Se enumera en vez de recorrer el repo entero por dos motivos: `node_modules` tiene
 * miles de `.md` que no son nuestros, y una lista explícita se lee y se audita.
 */
const RAICES = [
  { dir: ".", recursivo: false },
  { dir: "docs", recursivo: true },
  { dir: "athos-service", recursivo: true },
] as const

/**
 * Carpetas que no se pisan nunca, aunque caigan dentro de una raíz recursiva.
 *
 * `.agents` NO ES DOCUMENTACIÓN DE TUVETIA: son skills de terceros instalados (los paquetes que
 * publica Supabase), 40 archivos `.md` que hablan de Postgres en general y que nadie de este equipo
 * escribió ni mantiene. Son una dependencia vendorizada, igual que `node_modules`, y publicarlos
 * junto a la referencia del producto haría que la mitad del sitio fuera documentación ajena.
 */
const IGNORADAS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  ".agents",
  "dist",
  "build",
  "__pycache__",
])

function raizDelProyecto(): string {
  return process.cwd()
}

/** Recorre un directorio y devuelve las rutas `.md` relativas a la raíz del proyecto. */
async function archivosMd(dir: string, recursivo: boolean): Promise<string[]> {
  const absoluto = join(raizDelProyecto(), dir)
  let entradas
  try {
    entradas = await readdir(absoluto, { withFileTypes: true })
  } catch {
    // Una raíz que no existe no es un error: el repo puede no tener `athos-service` en un checkout
    // parcial, y eso no puede tumbar la documentación entera.
    return []
  }

  const salida: string[] = []
  for (const e of entradas) {
    if (IGNORADAS.has(e.name)) continue
    const rel = relative(raizDelProyecto(), join(absoluto, e.name)).split(sep).join("/")
    if (e.isDirectory()) {
      if (recursivo) salida.push(...(await archivosMd(rel, true)))
    } else if (e.name.toLowerCase().endsWith(".md")) {
      salida.push(rel)
    }
  }
  return salida
}

async function leerDocumento(archivo: string): Promise<Documento | null> {
  let crudo: string
  try {
    crudo = await readFile(join(raizDelProyecto(), archivo), "utf8")
  } catch {
    // Un archivo ilegible se OMITE en vez de romper el catálogo: la documentación entera no puede
    // caerse porque uno de noventa archivos no llegó al despliegue.
    return null
  }

  const { datos, cuerpo } = separarFrontmatter(crudo)
  return {
    slug: slugDe(archivo),
    titulo: tituloDe(datos, cuerpo, archivo),
    resumen: datos.resumen || null,
    seccion: seccionDe(datos, archivo),
    // `orden` sin declarar va al final de su sección, no al principio: un documento nuevo sin
    // metadatos no debería colarse arriba de los que sí se ordenaron a mano.
    orden: Number.isFinite(Number(datos.orden)) && datos.orden ? Number(datos.orden) : 999,
    archivo,
    fecha: datos.fecha || fechaEnElNombre(archivo),
    contenido: cuerpo,
  }
}

/**
 * Todos los documentos, una sola vez por petición.
 *
 * `cache` de React memoriza dentro del render: la barra lateral, el índice y la página del
 * documento piden el catálogo por separado y sería el mismo recorrido de disco tres veces. Entre
 * peticiones NO se guarda nada, y es a propósito: en desarrollo editar un `.md` tiene que verse al
 * recargar, sin reiniciar el servidor.
 */
export const catalogo = cache(async (): Promise<Documento[]> => {
  const rutas = (await Promise.all(RAICES.map((r) => archivosMd(r.dir, r.recursivo)))).flat()
  const docs = await Promise.all([...new Set(rutas)].map(leerDocumento))
  return docs.filter((d): d is Documento => d !== null)
})

/** El árbol para la barra lateral: secciones con sus documentos, ya ordenados. */
export async function arbol(): Promise<{ seccion: Seccion; documentos: Documento[] }[]> {
  return agruparPorSeccion(await catalogo())
}

/** Un documento por su slug, o `null` si no existe. */
export async function documentoPorSlug(slug: string): Promise<Documento | null> {
  return (await catalogo()).find((d) => d.slug === slug) ?? null
}
