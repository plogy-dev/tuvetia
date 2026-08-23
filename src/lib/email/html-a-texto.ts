// El cuerpo de un correo, en texto legible.
//
// SIN `server-only`: lo usa el adaptador del proveedor (servidor) y puede necesitarlo la bandeja.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────────────────────
//
// Microsoft Graph entrega el cuerpo en `body.content`, y por defecto en **HTML**. Cuando la bandeja
// pasó a mostrar el cuerpo entero en vez del preview recortado (23-ago), eso significó pintar el
// fuente HTML como si fuera texto: un vet con Outlook abría un correo normal y leía
// `<html><head><meta http-equiv=...><style type="text/css">…` literal en pantalla.
//
// Era peor que lo que había antes —el preview, que Graph entrega en texto plano— y justo en la
// función que ese cambio venía a arreglar. Lo encontró un review, no la suite.
//
// SE LIMPIA EN EL ADAPTADOR y no en la pantalla, a propósito: `cuerpo` no lo consume sólo la
// bandeja. Cartera lo lee para clasificar la intención de una respuesta ("le transferí ayer, adjunto
// el soporte") y con etiquetas HTML adentro estaba clasificando sobre ruido. Un solo lugar, los dos
// consumidores arreglados.
//
// NO ES UN SANEADOR DE SEGURIDAD. No se usa para decidir qué es seguro insertar en el DOM —el texto
// que sale de acá se pinta como TEXTO, y React lo escapa igual. Es para que se lea.

/** Las entidades que aparecen de verdad en correos. No es la tabla completa de HTML, ni hace falta. */
const ENTIDADES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&hellip;": "…",
  "&mdash;": "—",
  "&ndash;": "–",
}

/**
 * ¿Esto parece HTML?
 *
 * Se usa cuando el proveedor NO dice el tipo. Pide una etiqueta de verdad —`<p>`, `<div>`, `<br>`—
 * y no un `<` suelto, porque un correo en texto plano bien puede decir "3 < 5" o traer un
 * `<correo@ejemplo.com>` entre ángulos, y convertir eso perdería texto real.
 */
export function pareceHtml(s: string): boolean {
  return /<(?:p|div|br|table|span|body|html|a|img|ul|li|h[1-6])\b[^>]*>/i.test(s)
}

/**
 * HTML → texto legible, conservando los saltos de línea que el maquetado implicaba.
 *
 * El orden importa: primero se van los bloques que no son contenido (`script`, `style`, comentarios
 * y la cabecera entera), después las etiquetas que separan párrafos se vuelven saltos, y recién ahí
 * se barre el resto. Al revés, el CSS de un `<style>` terminaría en el cuerpo del correo como texto.
 */
export function htmlATexto(html: string): string {
  let t = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<head\b[\s\S]*?<\/head>/gi, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    // Lo que en pantalla se ve como un corte de línea, acá lo es.
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)\s*>/gi, "\n")
    .replace(/<\/td\s*>/gi, "\t")
    .replace(/<[^>]+>/g, "")

  for (const [entidad, caracter] of Object.entries(ENTIDADES)) {
    t = t.split(entidad).join(caracter)
  }
  // Las numéricas, que Outlook usa bastante.
  t = t.replace(/&#(\d{1,6});/g, (_, n: string) => String.fromCodePoint(Number(n)))

  return t
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

/**
 * El cuerpo tal como lo entregó el proveedor, listo para leer.
 *
 * `tipo` es el `contentType` de Graph cuando viene. Si falta, se decide mirando el texto: hay
 * listados donde Graph manda el cuerpo sin decir de qué tipo es.
 */
export function cuerpoEnTexto(contenido: string | undefined | null, tipo?: string | null): string {
  const s = contenido ?? ""
  if (!s) return ""
  const esHtml = tipo ? tipo.toLowerCase() === "html" : pareceHtml(s)
  return esHtml ? htmlATexto(s) : s
}
