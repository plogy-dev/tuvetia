// Adjuntar documentos al chat de Athos (reunión 24-ago: "micrófono… y para subir documentos").
//
// El agente es de TEXTO: el documento no viaja como archivo, se EXTRAE acá en el navegador y entra
// al mensaje como bloque citado. Eso mantiene el contrato de /api/athos/agent intacto (texto plano)
// y funciona igual con toda la cascada de modelos (Anthropic/DeepSeek/Google), que no comparten
// soporte de archivos nativos.
//
// Formatos: texto plano (txt/md/csv), Excel vía la dependencia `xlsx` que ya usa la importación de
// pacientes, y PDF con CASCADA DE COSTOS (aprobada 25-ago):
//
//   Fase 1 — pdfjs-dist extrae el texto EN EL NAVEGADOR. Gratis, sin red. Cubre todo PDF digital.
//   Fase 2 — si la extracción sale vacía (PDF escaneado: los laboratorios impresos y fotografiados
//            son el caso real), el archivo cae AUTOMÁTICAMENTE a /api/athos/leer-documento, que lo
//            transcribe con el modelo de visión. Se paga UNA vez por documento, al adjuntarlo: al
//            chat entra ya como texto y los turnos siguientes no lo re-facturan.
export type Adjunto = { nombre: string; texto: string }

/** Lo que acepta el input de archivos. Espejo exacto de lo que `leerAdjunto` sabe extraer. */
export const ADJUNTOS_ACEPTA = ".txt,.md,.csv,.xlsx,.xls,.pdf"

// Tope de páginas del fallback con IA (espejo del route: el costo escala por página). Las primeras
// MAX_PAGINAS_TEXTO sí se extraen gratis aunque el documento sea más largo.
const MAX_PAGINAS_IA = 25
const MAX_PAGINAS_TEXTO = 40
const MAX_BYTES_PDF = 10_000_000 // ~10 MB; espejo del MAX_BASE64 del route

export const MAX_ADJUNTOS = 2

// Tope de texto POR ARCHIVO. Un mensaje del chat termina en el presupuesto de tokens del agente
// (maxOutputTokens aparte, el input también cuesta): un Excel de inventario completo no cabe ni
// tiene sentido — si se recorta, el bloque lo declara para que el modelo no crea que leyó todo.
const MAX_CHARS = 15000

function recortar(texto: string): { texto: string; recortado: boolean } {
  if (texto.length <= MAX_CHARS) return { texto, recortado: false }
  return { texto: texto.slice(0, MAX_CHARS), recortado: true }
}

/**
 * ¿El texto que sacó pdfjs alcanza, o el PDF es un escaneado?
 *
 * Un PDF digital de una página trae cientos de caracteres; uno escaneado trae cero o migajas
 * (números de página, un membrete OCR-eado a medias). El umbral es deliberadamente bajo: ante la
 * duda preferimos la fase gratis — si el texto era pobre de verdad, el vet lo ve en el chat y
 * puede reintentar; el error contrario (pagar el modelo por un PDF que ya tenía el texto) no lo
 * ve nadie y se paga siempre. Exportada para poder fijarla en tests.
 */
export function textoUtilDePdf(texto: string, paginas: number): boolean {
  const limpio = texto.replace(/\s+/g, " ").trim()
  if (limpio.length < 120) return false
  return limpio.length / Math.max(paginas, 1) >= 30
}

async function extraerTextoPdf(file: File): Promise<{ texto: string; paginas: number }> {
  // Import dinámico como xlsx: pdfjs pesa (~400 KB) y solo lo paga quien adjunta un PDF.
  const pdfjs = await import("pdfjs-dist")
  // El worker se resuelve como asset del bundle (patrón new URL soportado por el bundler de Next);
  // sin workerSrc, getDocument lanza.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString()
  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  try {
    const partes: string[] = []
    const hasta = Math.min(doc.numPages, MAX_PAGINAS_TEXTO)
    for (let i = 1; i <= hasta; i++) {
      const page = await doc.getPage(i)
      const contenido = await page.getTextContent()
      partes.push(contenido.items.map((it) => ("str" in it ? it.str : "")).join(" "))
    }
    return { texto: partes.join("\n\n"), paginas: doc.numPages }
  } finally {
    void doc.destroy() // libera el worker; con varios PDFs seguidos, no acumular documentos vivos
  }
}

/** File → base64 por trozos: `btoa(String.fromCharCode(...buf))` entero revienta la pila con MBs. */
async function aBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer())
  let bin = ""
  const TROZO = 0x8000
  for (let i = 0; i < buf.length; i += TROZO) {
    bin += String.fromCharCode(...buf.subarray(i, i + TROZO))
  }
  return btoa(bin)
}

/** Fase 2: el PDF escaneado se transcribe con el modelo de visión (una llamada por documento). */
async function leerPdfConIA(file: File, paginas: number): Promise<string> {
  if (paginas > MAX_PAGINAS_IA) {
    throw new Error(
      `"${file.name}" parece escaneado y tiene ${paginas} páginas — el tope para leerlo con IA es ${MAX_PAGINAS_IA}.`,
    )
  }
  const res = await fetch("/api/athos/leer-documento", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ nombre: file.name, pdf_base64: await aBase64(file), paginas }),
  })
  const body = (await res.json().catch(() => null)) as { texto?: string; error?: string } | null
  if (!res.ok || !body?.texto) {
    throw new Error(body?.error ?? `No se pudo leer "${file.name}".`)
  }
  return body.texto
}

/** Extrae el texto de un archivo. Lanza con mensaje en español si el formato no está soportado. */
export async function leerAdjunto(file: File): Promise<Adjunto> {
  const ext = file.name.toLowerCase().split(".").pop() ?? ""
  if (ext === "pdf") {
    if (file.size > MAX_BYTES_PDF) {
      throw new Error(`"${file.name}" pesa más de 10 MB — comprímelo o adjunta las páginas que importan.`)
    }
    const { texto, paginas } = await extraerTextoPdf(file)
    if (textoUtilDePdf(texto, Math.min(paginas, MAX_PAGINAS_TEXTO))) {
      const r = recortar(texto)
      return { nombre: file.name, texto: r.texto + (r.recortado ? "\n[… documento recortado]" : "") }
    }
    // Escaneado: cae solo a la fase 2. El costo (una llamada de visión) queda registrado en
    // athos_agent_usage como `leer_documento` y descuenta del cupo mensual de la clínica.
    const r = recortar(await leerPdfConIA(file, paginas))
    return { nombre: file.name, texto: r.texto + (r.recortado ? "\n[… documento recortado]" : "") }
  }
  if (ext === "xlsx" || ext === "xls") {
    // Import dinámico: xlsx pesa, y el 99% de los mensajes no adjuntan Excel.
    const XLSX = await import("xlsx")
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" })
    const partes: string[] = []
    for (const nombre of wb.SheetNames.slice(0, 3)) {
      partes.push(`— Hoja: ${nombre} —\n${XLSX.utils.sheet_to_csv(wb.Sheets[nombre])}`)
    }
    const { texto, recortado } = recortar(partes.join("\n\n"))
    return { nombre: file.name, texto: texto + (recortado ? "\n[… documento recortado]" : "") }
  }
  if (ext === "txt" || ext === "md" || ext === "csv") {
    const { texto, recortado } = recortar(await file.text())
    return { nombre: file.name, texto: texto + (recortado ? "\n[… documento recortado]" : "") }
  }
  throw new Error(`No puedo leer .${ext} todavía — acepto txt, md, csv y Excel.`)
}

/** El prefijo que viaja DELANTE de la pregunta cuando hay adjuntos. */
export function bloqueDeAdjuntos(adjuntos: Adjunto[]): string {
  return adjuntos
    .map((a) => `[Documento adjunto: ${a.nombre}]\n"""\n${a.texto}\n"""`)
    .join("\n\n")
}
