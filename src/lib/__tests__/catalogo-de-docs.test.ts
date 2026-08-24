/**
 * El catálogo de documentación: cómo se nombra, clasifica, ordena y busca cada `.md` del repo.
 *
 * LO QUE PROTEGE. Son 69 archivos que ya existían y ninguno tiene frontmatter — el caso normal es
 * el archivo "sin metadatos", no el bien formado. Si el catálogo tratara eso como un error, el sitio
 * saldría casi vacío y nadie lo notaría hasta buscar algo puntual.
 *
 * Y la mitad que de verdad importa: separar lo vigente de las fotos con fecha. Un `REVIEW` de julio
 * dice que cosas que hoy funcionan están rotas; si sale en la referencia, el sitio miente.
 */
import { describe, expect, it } from "vitest"

import {
  agruparPorSeccion,
  buscar,
  fechaEnElNombre,
  nombreLegible,
  normalizar,
  ordenarDocumentos,
  primerEncabezado,
  seccionDe,
  separarFrontmatter,
  slugDe,
  tituloDe,
  type Documento,
} from "@/lib/docs/documento"

function doc(over: Partial<Documento> = {}): Documento {
  return {
    slug: "referencia/secretos",
    titulo: "Secretos",
    resumen: null,
    seccion: "referencia",
    orden: 10,
    archivo: "docs/manual/30-referencia/secretos.md",
    fecha: null,
    contenido: "",
    ...over,
  }
}

describe("frontmatter", () => {
  it("separa los datos del cuerpo", () => {
    const { datos, cuerpo } = separarFrontmatter("---\ntitulo: Secretos\norden: 30\n---\n# Hola\n")
    expect(datos).toEqual({ titulo: "Secretos", orden: "30" })
    expect(cuerpo).toBe("# Hola\n")
  })

  it("un archivo SIN frontmatter no es un error", () => {
    // Es el caso normal: los 69 que ya existían no tienen ninguno.
    const { datos, cuerpo } = separarFrontmatter("# Calendario\n\nTexto.")
    expect(datos).toEqual({})
    expect(cuerpo).toBe("# Calendario\n\nTexto.")
  })

  it("aguanta dos puntos y comillas en el valor", () => {
    const { datos } = separarFrontmatter('---\ntitulo: "Correo: cómo sale"\n---\ncuerpo')
    expect(datos.titulo).toBe("Correo: cómo sale")
  })

  it("ignora las líneas que no entiende en vez de descartar el documento", () => {
    // Un documento que no se puede leer por una coma es peor que uno con el título del encabezado.
    const { datos, cuerpo } = separarFrontmatter("---\ntitulo: Algo\nbasura sin dos puntos\n---\ncuerpo")
    expect(datos).toEqual({ titulo: "Algo" })
    expect(cuerpo).toBe("cuerpo")
  })

  it("no confunde una línea de guiones del cuerpo con el delimitador", () => {
    const { datos, cuerpo } = separarFrontmatter("# Título\n\n---\n\nUn separador.")
    expect(datos).toEqual({})
    expect(cuerpo).toContain("Un separador.")
  })
})

describe("el título, con sus respaldos", () => {
  it("manda el frontmatter", () => {
    expect(tituloDe({ titulo: "Del frontmatter" }, "# Del encabezado", "a/b.md")).toBe("Del frontmatter")
  })

  it("sin frontmatter, el primer encabezado", () => {
    expect(tituloDe({}, "# Del encabezado\n\ntexto", "a/b.md")).toBe("Del encabezado")
  })

  it("sin ninguno de los dos, el nombre del archivo — feo a propósito", () => {
    // Un documento sin título tiene que verse feo en la lista para que alguien lo arregle. Si
    // dijera "Sin título", los rotos serían indistinguibles entre sí.
    expect(tituloDe({}, "texto suelto", "docs/traspaso/RESUMEN-EJECUTIVO.md")).toBe("RESUMEN EJECUTIVO")
  })

  it("el encabezado tiene que ser de nivel 1, no cualquier almohadilla", () => {
    expect(primerEncabezado("## Subtítulo\n# Título real")).toBe("Título real")
    expect(primerEncabezado("sin encabezados")).toBeNull()
  })

  it("nombreLegible saca la extensión y los guiones", () => {
    expect(nombreLegible("docs/AGENT-SMOKE-TESTING.md")).toBe("AGENT SMOKE TESTING")
  })
})

describe("fecha en el nombre", () => {
  it("la encuentra donde esté", () => {
    expect(fechaEnElNombre("docs/REVIEW-2026-08-03b.md")).toBe("2026-08-03")
    expect(fechaEnElNombre("athos-service/docs/AUDITORIA-2026-07-30-1600.md")).toBe("2026-07-30")
  })

  it("no inventa una fecha con cualquier número que cumpla la forma", () => {
    // `1234-56-78` pasa el patrón y no es una fecha. Sin validar el rango, un documento vigente se
    // archivaría por su nombre y desaparecería de la referencia sin que nadie lo note.
    expect(fechaEnElNombre("archivo-1234-56-78.md")).toBeNull()
    expect(fechaEnElNombre("docs/API.md")).toBeNull()
  })
})

describe("en qué sección cae cada documento", () => {
  it("el frontmatter manda", () => {
    expect(seccionDe({ seccion: "referencia" }, "docs/manual/x.md")).toBe("referencia")
  })

  it("una sección inventada no se acepta: cae a la inferencia", () => {
    expect(seccionDe({ seccion: "inventada" }, "docs/API.md")).toBe("repositorio")
  })

  it("con fecha en el nombre, al histórico", () => {
    expect(seccionDe({}, "docs/REVIEW-2026-08-03.md")).toBe("historico")
    expect(seccionDe({}, "PLAN-REMEDIACION-2026-07-30.md")).toBe("historico")
  })

  it("sin fecha, es un documento vigente del repositorio", () => {
    expect(seccionDe({}, "CALENDARIO.md")).toBe("repositorio")
    expect(seccionDe({}, "docs/SEGURIDAD-DB.md")).toBe("repositorio")
  })

  it("las instantáneas sin fecha en el nombre también se archivan", () => {
    // No hay señal en el nombre que las delate y publicarlas como vigentes afirmaría cosas que
    // dejaron de ser ciertas.
    expect(seccionDe({}, "docs/traspaso/INCIDENTES.md")).toBe("historico")
    expect(seccionDe({}, "docs/BANCO-AGENTE-RESULTADO.md")).toBe("historico")
  })
})

describe("slug", () => {
  it("recorta docs/manual y los prefijos de orden", () => {
    expect(slugDe("docs/manual/30-referencia/10-secretos.md")).toBe("referencia/secretos")
  })

  it("conserva la ruta del resto del repo, para que no choquen dos nombres iguales", () => {
    // `README.md` existe en la raíz, en `athos-service/` y en `docs/entrega/`. Sin la ruta, los tres
    // colapsarían en el mismo slug y dos de ellos serían inalcanzables.
    expect(slugDe("README.md")).toBe("readme")
    expect(slugDe("athos-service/README.md")).toBe("athos-service/readme")
    expect(slugDe("docs/entrega/README.md")).toBe("docs/entrega/readme")
  })

  it("normaliza acentos y mayúsculas", () => {
    expect(slugDe("docs/MIGRACIÓN-Ñoña.md")).toBe("docs/migracion-nona")
  })
})

describe("orden", () => {
  it("manda `orden`, y a empate el título", () => {
    const docs = [
      doc({ titulo: "Z", orden: 1 }),
      doc({ titulo: "A", orden: 2 }),
      doc({ titulo: "B", orden: 2 }),
    ]
    expect(ordenarDocumentos(docs, "referencia").map((d) => d.titulo)).toEqual(["Z", "A", "B"])
  })

  it("en el histórico manda la fecha, la más nueva arriba", () => {
    // En una lista de fotos lo que se busca casi siempre es la última; por título se mezclan por el
    // nombre del mes.
    const docs = [
      doc({ titulo: "Vieja", seccion: "historico", fecha: "2026-07-01" }),
      doc({ titulo: "Nueva", seccion: "historico", fecha: "2026-08-16" }),
    ]
    expect(ordenarDocumentos(docs, "historico").map((d) => d.titulo)).toEqual(["Nueva", "Vieja"])
  })
})

describe("agrupar por sección", () => {
  it("respeta el orden de las secciones y omite las vacías", () => {
    const grupos = agruparPorSeccion([doc({ seccion: "historico" }), doc({ seccion: "empezar" })])
    expect(grupos.map((g) => g.seccion)).toEqual(["empezar", "historico"])
  })
})

describe("búsqueda", () => {
  const CORPUS = [
    doc({ titulo: "Secretos", contenido: "WOMPI_EVENTS_SECRET se usa para firmar." }),
    doc({ titulo: "Calendario", resumen: "Citas y Google Calendar", contenido: "texto" }),
    doc({
      titulo: "Diagnóstico de agosto",
      seccion: "historico",
      contenido: "el calendario no funciona",
    }),
  ]

  it("encuentra por el CUERPO, que es donde está lo que se busca", () => {
    // Casi todo lo que alguien viene a buscar acá —el nombre de una variable, una tabla, el número
    // de una migración— aparece en el texto y no en el título.
    expect(buscar(CORPUS, "WOMPI_EVENTS_SECRET").map((d) => d.titulo)).toEqual(["Secretos"])
  })

  it("el título pesa más que el cuerpo", () => {
    expect(buscar(CORPUS, "calendario")[0].titulo).toBe("Calendario")
  })

  it("lo histórico pesa menos a igualdad de coincidencia", () => {
    // Buscando "calendario", la referencia vigente tiene que salir antes que el diagnóstico de
    // julio que decía que estaba roto.
    const r = buscar(CORPUS, "calendario").map((d) => d.seccion)
    expect(r.indexOf("historico")).toBe(r.length - 1)
  })

  it("ignora acentos y mayúsculas en los dos sentidos", () => {
    expect(buscar(CORPUS, "diagnostico")).toHaveLength(1)
    expect(normalizar("Facturación")).toBe("facturacion")
  })

  it("una consulta vacía no devuelve todo", () => {
    // Devolver el corpus entero ante un campo en blanco se lee como "encontré 120 resultados".
    expect(buscar(CORPUS, "   ")).toEqual([])
  })
})

// ── Los documentos reales del manual ────────────────────────────────────────────────────────────
//
// Los de arriba prueban la REGLA con datos inventados. Éstos prueban que los archivos que de verdad
// existen la cumplen — que es otra cosa, y es la que se rompe sola: alguien agrega un documento sin
// frontmatter y aparece callado en "Documentos del repositorio", ordenado al final, en vez de en la
// sección donde lo quería. Nada falla; simplemente no está donde debería.

import { readFileSync, readdirSync } from "node:fs"
import { join, relative, sep } from "node:path"

import { SECCIONES } from "@/lib/docs/documento"

const MANUAL = join(process.cwd(), "docs", "manual")

/** La ruta como la ve el catalogo: relativa a la raiz y con barras hacia adelante. */
function rutaRelativa(absoluta: string): string {
  return relative(process.cwd(), absoluta).split(sep).join("/")
}

function archivosDelManual(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? archivosDelManual(join(dir, e.name)) : e.name.endsWith(".md") ? [join(dir, e.name)] : [],
  )
}

describe("los documentos del manual están bien formados", () => {
  const archivos = archivosDelManual(MANUAL)

  it("hay documentos que revisar (si no, el test no mide nada)", () => {
    expect(archivos.length).toBeGreaterThan(10)
  })

  it("todos declaran título, sección válida, orden y resumen", () => {
    for (const ruta of archivos) {
      const { datos } = separarFrontmatter(readFileSync(ruta, "utf8"))
      expect(datos.titulo, `${ruta}: falta \`titulo\``).toBeTruthy()
      expect(datos.resumen, `${ruta}: falta \`resumen\` (se muestra en el índice)`).toBeTruthy()
      expect(
        (SECCIONES as readonly string[]).includes(datos.seccion),
        `${ruta}: sección "${datos.seccion}" no existe`,
      ).toBe(true)
      expect(Number.isFinite(Number(datos.orden)), `${ruta}: \`orden\` no es un número`).toBe(true)
    }
  })

  it("ningún documento del manual cae al histórico por su nombre", () => {
    // Una fecha en el nombre de un archivo del manual lo mandaría al archivo, con el cartel de "esto
    // ya no es cierto" encima de la referencia vigente.
    for (const ruta of archivos) {
      const rel = rutaRelativa(ruta)
      const { datos } = separarFrontmatter(readFileSync(ruta, "utf8"))
      expect(seccionDe(datos, rel), `${ruta} terminó en el histórico`).not.toBe("historico")
    }
  })

  it("no hay dos documentos con el mismo slug", () => {
    const slugs = archivos.map((r) => slugDe(rutaRelativa(r)))
    expect(new Set(slugs).size, `slugs repetidos en: ${slugs.join(", ")}`).toBe(slugs.length)
  })
})
