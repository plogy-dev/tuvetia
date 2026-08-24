// Qué es un documento, cómo se lo nombra y a qué sección pertenece.
//
// ── POR QUÉ HAY UN CATÁLOGO Y NO UNA CARPETA A SECAS ────────────────────────────────────────────
//
// La documentación de Tuvetia estaba en 69 archivos `.md` repartidos por todo el repo: la raíz,
// `docs/`, `docs/entrega/`, `docs/traspaso/`, `athos-service/docs/`. Todos valen —ahí está escrito
// POR QUÉ se decidió casi todo lo que hay— pero no se pueden leer: hay que saber que existen y en
// qué carpeta cayeron.
//
// Este módulo los vuelve un solo árbol navegable sin moverlos de lugar. Los archivos siguen siendo
// la fuente de verdad: se editan donde están, con git, y el sitio los refleja.
//
// ── LA DECISIÓN QUE NO ES OBVIA: SEPARAR LO VIGENTE DE LO FECHADO ───────────────────────────────
//
// Buena parte de esos 69 son FOTOS con fecha —`REVIEW-2026-08-03`, `AUDITORIA-2026-07-30`,
// `DIAGNOSTICO-2026-08-16`—: dicen cómo estaba el sistema ese día, y hoy varias afirmaciones suyas
// son falsas a propósito, porque lo que describían se arregló después.
//
// Publicarlos junto a la referencia vigente sería peor que no publicarlos: alguien buscando cómo
// funciona el calendario encontraría primero un diagnóstico de julio que dice que está roto. Van a
// su propia sección, marcados, y no se pierde nada — que es lo que se pidió.
//
// PURO Y SIN `fs`: la lectura del disco vive en `catalogo.ts` (server-only). Acá está la regla, y
// `vitest.config.mts` corre en `environment: "node"` sobre `src/**/*.test.ts`.

/** Las secciones del sitio, en el orden en que se muestran. */
export const SECCIONES = [
  "empezar",
  "guias",
  "referencia",
  "explicacion",
  "repositorio",
  "historico",
] as const

export type Seccion = (typeof SECCIONES)[number]

export const TITULO_DE_SECCION: Record<Seccion, string> = {
  empezar: "Empezar",
  guias: "Guías",
  referencia: "Referencia",
  explicacion: "Explicación",
  repositorio: "Documentos del repositorio",
  historico: "Histórico",
}

export const DESCRIPCION_DE_SECCION: Record<Seccion, string> = {
  empezar: "Levantar el proyecto y entender de qué está hecho, en orden.",
  guias: "Cómo se hace cada cosa: por pantalla y por tarea.",
  referencia: "El dato exacto: servicios, secretos, rutas, esquema y permisos.",
  explicacion: "Por qué el sistema es como es, y qué se descartó en el camino.",
  repositorio: "Los documentos vigentes que viven junto al código, tal como están.",
  historico: "Fotos con fecha. Valen como registro, no como referencia vigente.",
}

/**
 * Las cuatro primeras son Diátaxis, que es el estándar con el que se organiza documentación
 * técnica: tutoriales (empezar), guías de tarea, referencia y explicación. La separación importa
 * porque son cuatro formas distintas de escribir, y mezclarlas es lo que vuelve ilegible un manual:
 * quien está aprendiendo no quiere una tabla de variables, y quien busca una variable no quiere un
 * tutorial.
 */
export const SECCIONES_DIATAXIS: readonly Seccion[] = ["empezar", "guias", "referencia", "explicacion"]

export type Documento = {
  /** Ruta URL, sin `/admin/docs`. Ej: `referencia/secretos`. */
  slug: string
  titulo: string
  resumen: string | null
  seccion: Seccion
  /** Dentro de su sección. Menor primero; los empatados van alfabéticos por título. */
  orden: number
  /** Ruta del archivo en el repo, tal cual, para poder ir a editarlo. */
  archivo: string
  /** Fecha que el propio nombre del archivo declara, si la declara. */
  fecha: string | null
  contenido: string
}

// ── Frontmatter ─────────────────────────────────────────────────────────────────────────────────
//
// SE PARSEA A MANO Y NO CON UNA DEPENDENCIA (`gray-matter`, `yaml`) porque el frontmatter de este
// sitio lo escribimos nosotros y son cuatro claves de texto plano. Traer un parser de YAML entero
// —con sus anclas, sus tipos y su superficie— para leer `titulo: algo` es cambiar una función de
// veinte líneas por un árbol de dependencias.
//
// Los 69 archivos que ya existían NO tienen frontmatter, y eso no es un error: es el caso normal.
// Sin él, el título sale del primer `# encabezado` y la sección se infiere del nombre del archivo.

/**
 * Los diacriticos combinantes (U+0300-U+036F): lo que `normalize("NFD")` deja suelto al
 * separar cada letra acentuada en letra + tilde. Quitarlos es lo que hace que buscar
 * "facturacion" encuentre "facturación" y al reves.
 *
 * VA CON ESCAPES Y NO CON LOS CARACTERES LITERALES: escritos crudos son invisibles en
 * cualquier editor y el primer reencode del archivo se los come sin que nada falle.
 */
const DIACRITICOS = /[\u0300-\u036f]/g

export type Frontmatter = Record<string, string>

const DELIMITADOR = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Separa el frontmatter del cuerpo.
 *
 * Un archivo sin frontmatter devuelve `{}` y el cuerpo intacto — NUNCA se lo trata como un error.
 * Y un frontmatter que no se entiende tampoco rompe: se ignoran las líneas que no son `clave: valor`
 * en vez de descartar el documento. Un documento que no se puede leer por una coma es peor que uno
 * con el título tomado del encabezado.
 */
export function separarFrontmatter(crudo: string): { datos: Frontmatter; cuerpo: string } {
  const m = DELIMITADOR.exec(crudo)
  if (!m) return { datos: {}, cuerpo: crudo }

  const datos: Frontmatter = {}
  for (const linea of m[1].split(/\r?\n/)) {
    const corte = linea.indexOf(":")
    if (corte < 1) continue
    const clave = linea.slice(0, corte).trim()
    // Las comillas son opcionales y se quitan: `titulo: "Algo: con dos puntos"` tiene que funcionar,
    // y sin quitarlas el título se pintaría con las comillas incluidas.
    const valor = linea
      .slice(corte + 1)
      .trim()
      .replace(/^["'](.*)["']$/, "$1")
    if (clave) datos[clave] = valor
  }
  return { datos, cuerpo: crudo.slice(m[0].length) }
}

/** El primer `# encabezado` del cuerpo, que es de dónde sale el título cuando no hay frontmatter. */
export function primerEncabezado(cuerpo: string): string | null {
  const m = /^#\s+(.+?)\s*$/m.exec(cuerpo)
  return m ? m[1].trim() : null
}

/**
 * El título, con tres respaldos en orden.
 *
 * El último —el nombre del archivo— nunca es bonito, y esa es exactamente la gracia: un documento
 * sin título se ve feo en la lista y alguien lo arregla. Si en su lugar dijera "Sin título", los
 * documentos rotos serían indistinguibles entre sí y nadie sabría cuál abrir para arreglarlo.
 */
export function tituloDe(datos: Frontmatter, cuerpo: string, archivo: string): string {
  if (datos.titulo) return datos.titulo
  const encabezado = primerEncabezado(cuerpo)
  if (encabezado) return encabezado
  return nombreLegible(archivo)
}

/** `docs/traspaso/RESUMEN-EJECUTIVO.md` → `RESUMEN EJECUTIVO`. */
export function nombreLegible(archivo: string): string {
  const base = archivo.split("/").pop() ?? archivo
  return base.replace(/\.md$/i, "").replace(/[-_]+/g, " ").trim()
}

// ── Fechas y clasificación ──────────────────────────────────────────────────────────────────────

/** `AUDITORIA-2026-07-30-1600.md` → `2026-07-30`. Null si el nombre no declara ninguna. */
export function fechaEnElNombre(archivo: string): string | null {
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(archivo)
  if (!m) return null
  const [, a, mes, d] = m
  // Se valida el rango, no sólo la forma: `1234-56-78` cumple el patrón y no es una fecha, y un
  // documento archivado por error deja de aparecer en la referencia vigente sin que nadie lo note.
  const nMes = Number(mes)
  const nDia = Number(d)
  if (nMes < 1 || nMes > 12 || nDia < 1 || nDia > 31) return null
  return `${a}-${mes}-${d}`
}

/**
 * Documentos sin fecha en el nombre que igual son una foto de un momento.
 *
 * Se enumeran porque no hay señal en el nombre que los delate, y publicarlos como referencia
 * vigente sería afirmar cosas que dejaron de ser ciertas. Es una lista corta y a mano: inferirlo de
 * palabras como "PLAN" o "NOTA" archivaría de más — `PLAN-ADMIN` describe algo que se construyó y
 * sigue en pie.
 */
const INSTANTANEAS_SIN_FECHA = new Set([
  "docs/BANCO-AGENTE-RESULTADO.md",
  "docs/NOTA-INFINITY-el-corpus-a-escala.md",
  "docs/NOTA-SANTIAGO-costuras-de-suscripciones.md",
  "docs/entrega/CAPA-AGENTICA-ESTADO.md",
  "docs/traspaso/INCIDENTES.md",
  "docs/traspaso/RESUMEN-EJECUTIVO.md",
  "docs/traspaso/INVENTARIO.md",
])

/**
 * En qué sección cae un archivo.
 *
 * El frontmatter MANDA cuando declara una sección válida: es lo que escribimos a propósito. Todo lo
 * demás se infiere, y la inferencia sólo distingue dos cosas — si tiene fecha, es histórico; si no,
 * es un documento vigente del repositorio.
 */
export function seccionDe(datos: Frontmatter, archivo: string): Seccion {
  const declarada = datos.seccion as Seccion | undefined
  if (declarada && (SECCIONES as readonly string[]).includes(declarada)) return declarada
  if (fechaEnElNombre(archivo) || INSTANTANEAS_SIN_FECHA.has(archivo)) return "historico"
  return "repositorio"
}

/**
 * El slug de un archivo: su ruta sin extensión, en minúsculas y sin caracteres raros.
 *
 * `docs/manual/` se recorta del principio porque es un detalle de dónde guardamos las cosas, no
 * algo que deba aparecer en la URL: `referencia/secretos` se lee, `manual/30-referencia/secretos`
 * no. Los prefijos numéricos de orden (`10-`, `20-`) también se van por lo mismo.
 */
export function slugDe(archivo: string): string {
  return archivo
    .replace(/^docs\/manual\//, "")
    .replace(/\.md$/i, "")
    .split("/")
    .map((parte) =>
      parte
        .replace(/^\d+[-_]/, "")
        .toLowerCase()
        .normalize("NFD")
        .replace(DIACRITICOS, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, ""),
    )
    .filter(Boolean)
    .join("/")
}

/**
 * Ordena los documentos de una sección.
 *
 * `orden` primero; a igual orden, alfabético por título. En `historico` manda la FECHA, más nueva
 * arriba: en una lista de fotos lo que se busca casi siempre es la última, y ordenarlas por título
 * las mezcla por el nombre del mes.
 */
export function ordenarDocumentos(docs: Documento[], seccion: Seccion): Documento[] {
  const copia = [...docs]
  if (seccion === "historico") {
    return copia.sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || a.titulo.localeCompare(b.titulo, "es"))
  }
  return copia.sort((a, b) => a.orden - b.orden || a.titulo.localeCompare(b.titulo, "es"))
}

/** Agrupa por sección, en el orden de `SECCIONES`, sin devolver las secciones vacías. */
export function agruparPorSeccion(docs: Documento[]): { seccion: Seccion; documentos: Documento[] }[] {
  return SECCIONES.map((seccion) => ({
    seccion,
    documentos: ordenarDocumentos(
      docs.filter((d) => d.seccion === seccion),
      seccion,
    ),
  })).filter((g) => g.documentos.length > 0)
}

// ── Búsqueda ────────────────────────────────────────────────────────────────────────────────────

/**
 * Busca en título, resumen y CUERPO.
 *
 * El cuerpo es la mitad que importa: casi todo lo que alguien viene a buscar acá —el nombre de una
 * variable de entorno, una tabla, el número de una migración— aparece en el texto y no en el
 * título. Una búsqueda que sólo mira títulos no encuentra `WOMPI_EVENTS_SECRET` en ningún lado.
 *
 * Sin índice ni puntajes: son ~90 documentos y se filtran en memoria en el servidor. Un buscador
 * de verdad haría falta con dos órdenes de magnitud más.
 */
export function buscar(docs: Documento[], consulta: string): Documento[] {
  const q = normalizar(consulta)
  if (!q) return []
  return docs
    .map((d) => ({ d, peso: pesoDeCoincidencia(d, q) }))
    .filter((x) => x.peso > 0)
    .sort((a, b) => b.peso - a.peso || a.d.titulo.localeCompare(b.d.titulo, "es"))
    .map((x) => x.d)
}

/** Sin acentos y en minúsculas, para que "facturación" encuentre "facturacion" y al revés. */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .trim()
}

/**
 * Cuánto pesa una coincidencia. Título > resumen > cuerpo.
 *
 * Lo histórico pesa MENOS a igualdad de coincidencia: si alguien busca "calendario", la referencia
 * vigente tiene que salir antes que el diagnóstico de julio que decía que estaba roto.
 */
function pesoDeCoincidencia(d: Documento, q: string): number {
  let peso = 0
  if (normalizar(d.titulo).includes(q)) peso += 10
  if (d.resumen && normalizar(d.resumen).includes(q)) peso += 5
  if (normalizar(d.contenido).includes(q)) peso += 1
  if (peso > 0 && d.seccion === "historico") peso -= 0.5
  return peso
}
