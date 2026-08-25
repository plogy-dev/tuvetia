// Adjuntar documentos al chat de Athos (reunión 24-ago: "micrófono… y para subir documentos").
//
// El agente es de TEXTO: el documento no viaja como archivo, se EXTRAE acá en el navegador y entra
// al mensaje como bloque citado. Eso mantiene el contrato de /api/athos/agent intacto (texto plano)
// y funciona igual con toda la cascada de modelos (Anthropic/DeepSeek/Google), que no comparten
// soporte de archivos nativos.
//
// Formatos: texto plano (txt/md/csv) y Excel vía la dependencia `xlsx` que ya usa la importación de
// pacientes. PDF queda PENDIENTE a propósito: exige sumar pdfjs-dist (peso real en el bundle) o
// pasar a file-parts multimodales — es una decisión de producto, no un TODO que se cuela.
export type Adjunto = { nombre: string; texto: string }

/** Lo que acepta el input de archivos. Espejo exacto de lo que `leerAdjunto` sabe extraer. */
export const ADJUNTOS_ACEPTA = ".txt,.md,.csv,.xlsx,.xls"

export const MAX_ADJUNTOS = 2

// Tope de texto POR ARCHIVO. Un mensaje del chat termina en el presupuesto de tokens del agente
// (maxOutputTokens aparte, el input también cuesta): un Excel de inventario completo no cabe ni
// tiene sentido — si se recorta, el bloque lo declara para que el modelo no crea que leyó todo.
const MAX_CHARS = 15000

function recortar(texto: string): { texto: string; recortado: boolean } {
  if (texto.length <= MAX_CHARS) return { texto, recortado: false }
  return { texto: texto.slice(0, MAX_CHARS), recortado: true }
}

/** Extrae el texto de un archivo. Lanza con mensaje en español si el formato no está soportado. */
export async function leerAdjunto(file: File): Promise<Adjunto> {
  const ext = file.name.toLowerCase().split(".").pop() ?? ""
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
