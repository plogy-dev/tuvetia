// La envoltura HTML de TODO el correo que sale de Tuvetia.
//
// SIN `server-only` A PROPÓSITO: es una función pura de datos a texto. La necesita el servidor para
// enviar y la puede necesitar el panel para armar una vista previa — y si el preview usara otra
// función que el envío, el preview mentiría.
//
// ── POR QUÉ EXISTE ────────────────────────────────────────────────────────────────────────────
//
// Hasta hoy TODO el correo de Tuvetia salía en texto plano: la invitación al equipo, la factura, el
// recordatorio de cobranza, el aviso a los titulares, el masivo de plataforma. Ninguno pasaba `html`
// al transporte. Un correo así llega sin marca, sin jerarquía y sin un botón donde apretar — y a un
// filtro de spam le cuesta distinguirlo de un envío automático cualquiera.
//
// ESTA ES LA ÚNICA ENVOLTURA. No se escribe HTML de correo en ningún otro archivo. El día que haya
// que mover el color de marca o agregar una línea al pie se cambia acá y cambia en todos, que es
// justamente lo que hoy no se puede hacer con cinco sitios redactando su propio texto.
//
// ── UN CORREO NO ES UNA PÁGINA WEB ────────────────────────────────────────────────────────────
//
// Todo lo que sigue parece de 2005 y no es nostalgia: es lo que sobrevive al recorrido real.
//
//  · TABLAS, no flexbox ni grid. Outlook de escritorio maqueta con el motor de Word, que no conoce
//    ninguno de los dos. Un layout moderno ahí no se degrada: se desarma en una columna de texto
//    apilado, y ese cliente es el que más usan las clínicas.
//
//  · ESTILOS EN LÍNEA, elemento por elemento. Gmail descarta el `<head>` entero en la vista de la
//    app móvil. Hay un `<style>` igual, pero SÓLO con mejoras (el ancho fluido en pantalla chica):
//    si un cliente lo tira, el correo sigue viéndose bien. Nada depende sólo de él.
//
//  · NADA DE `var(--…)`. Las variables CSS de `globals.css` no existen del otro lado: el correo se
//    abre en Gmail, no en la app. Los colores van como literales hex, copiados de la paleta de
//    marca (`globals.css`, primitivos `--tv-*`).
//
//  · MODO OSCURO. Muchos clientes invierten los colores por su cuenta y rompen el diseño. Se declara
//    `color-scheme: light` para pedirles que no lo hagan, y —porque varios lo ignoran— cada celda
//    pinta SIEMPRE fondo y color explícitos. Un fondo transparente es exactamente el que el cliente
//    se siente libre de invertir, y ahí es donde queda texto oscuro sobre fondo oscuro.
//
//  · PREHEADER. Es el texto que la bandeja muestra al lado del asunto. Sin él, el cliente agarra las
//    primeras palabras del cuerpo —o sea "Tuvetia"— y las pone ahí. Va oculto al principio del body.
//
// ── LOS ENLACES SE VEN, ADEMÁS DE SER CLICABLES ───────────────────────────────────────────────
//
// Un `href` no sobrevive a la conversión a texto plano: `<a href="X">Ver factura</a>` se convierte
// en "Ver factura" y la dirección se pierde. Como la alternativa `text/plain` de cada correo se
// DERIVA de este HTML (ver `resend.ts`), cualquier URL que no esté también escrita como texto
// visible desaparece para quien lee en modo texto — y en el caso del enlace de baja, eso no es una
// molestia: es el derecho de revocación de la Ley 1581 evaporándose.
//
// Por eso el botón lleva debajo su dirección escrita, y los enlaces del pie muestran la URL. De
// paso resuelve el otro caso: el cliente que bloquea o rompe el botón y deja al lector sin nada.

import { htmlATexto } from "./html-a-texto"

// ── La paleta, en literales ───────────────────────────────────────────────────────────────────
// Copiada de `src/app/globals.css` (primitivos `--tv-*`). Si allá cambia el verde de marca, acá hay
// que venir a mano: no hay forma de compartir un token entre la app y un cliente de correo ajeno.
const MENTA = "#12856a" /* --tv-mint-500 — rellenos: la barra de marca y el botón */
const MENTA_OSCURA = "#0f6e58" /* --tv-mint-600 — 6.3:1 sobre blanco: el que va en TEXTO y enlaces */
const MENTA_CLARA = "#e6f2ee" /* --tv-mint-100 — bordes y el bloque de datos */
const NIEVE = "#f5f8f7" /* --tv-snow — el fondo de la página del correo */
const TINTA = "#0c1613" /* --tv-graphite — el texto */
const TINTA_SUAVE = "#46534f" /* --text-2 — 8:1 sobre blanco: el pie y las letras chicas */
const BLANCO = "#ffffff"

// Las comillas van SIMPLES: esto se mete dentro de un atributo `style="…"` y unas dobles lo cortan.
const FUENTE = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

/** El botón de acción. Uno solo por correo: dos llamados a la acción es ninguno. */
export type BotonDeCorreo = {
  texto: string
  url: string
}

/** Una fila del bloque de datos: "Factura", "FV-0123". */
export type DatoDelCorreo = {
  etiqueta: string
  valor: string
}

/**
 * Una línea del pie. Con `url` se dibuja como "texto: https://…" — el enlace VISIBLE, por lo
 * explicado arriba: la baja tiene que seguir existiendo en la versión en texto plano.
 */
export type LineaDePie = string | { texto: string; url: string }

export interface CorreoMaquetado {
  /** El encabezado grande del correo. No es el asunto, aunque suelan parecerse. */
  titulo: string
  /**
   * Lo que la bandeja muestra junto al asunto. **Obligatorio a propósito**: es un campo que se
   * omite por olvido, no por decisión, y el costo del olvido lo paga el destinatario.
   */
  preheader: string
  /** Un `<p>` por elemento. Los saltos de línea de adentro se respetan como `<br>`. */
  parrafos: string[]
  /** Datos duros en dos columnas (número de factura, monto, vencimiento). */
  datos?: DatoDelCorreo[] | null
  boton?: BotonDeCorreo | null
  /** Líneas chicas al final. La marca de Tuvetia se agrega sola: acá va lo del caso puntual. */
  pie?: LineaDePie[] | null
}

/**
 * Escapa para HTML.
 *
 * TODO lo que venga de datos pasa por acá antes de tocar la salida: nombres de titular, de clínica,
 * montos, asuntos escritos por un admin. Un titular que se llame `Ana <b>` no puede desarmar la
 * maqueta, y el cuerpo de un aviso masivo lo redacta una persona en un textarea.
 *
 * El `&` va PRIMERO. Al revés, el `&` de un `&lt;` recién escrito se volvería `&amp;lt;` y el
 * destinatario leería la entidad en pantalla.
 */
export function escaparHtml(valor: string): string {
  return valor
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/** Los únicos esquemas que tienen sentido en un correo nuestro. */
const ESQUEMA_PERMITIDO = /^(?:https?|mailto):/i

/**
 * La URL si se puede poner en un `href`, o `null`.
 *
 * Escapar las comillas alcanza para que la dirección no se escape del atributo, pero NO para que sea
 * inofensiva: `javascript:` sigue siendo un `href` válido y hay clientes de escritorio que lo
 * ejecutan. Se limpian antes los espacios y los caracteres de control porque `java\nscript:` pasa
 * cualquier comparación ingenua de prefijo.
 */
export function urlSegura(url: string): string | null {
  const limpia = url.replace(/[\u0000-\u0020\u007f]/g, "")
  if (!limpia || !ESQUEMA_PERMITIDO.test(limpia)) return null
  return limpia
}

/**
 * Texto plano → párrafos, cortando por línea en blanco.
 *
 * Es la pieza de migración: hoy todos los sitios de envío tienen el cuerpo escrito como un string
 * con `\n\n` en el medio. Con esto se maquetan sin reescribir la redacción, que ya está pensada y
 * revisada, y los saltos simples de adentro de un párrafo se conservan como `<br>`.
 */
export function parrafosDeTexto(texto: string): string[] {
  return texto
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
}

/** Marca del bloque del preheader, para poder quitarlo al derivar el texto plano. */
const MARCA_PREHEADER = "data-tv-preheader"
const PREHEADER_RE = new RegExp(`<div\\b[^>]*\\b${MARCA_PREHEADER}\\b[^>]*>[\\s\\S]*?</div>`, "gi")

/**
 * El HTML del correo, en texto legible: la alternativa `text/plain` del mismo mensaje.
 *
 * Reusa `htmlATexto`, que ya existía para la bandeja. Lo único que agrega es SACAR EL PREHEADER:
 * está oculto para el que lee el HTML, pero `htmlATexto` no sabe de estilos y lo dejaría como primer
 * renglón del correo, repitiendo el resumen y arrastrando los caracteres invisibles del relleno.
 */
export function textoDelCorreo(html: string): string {
  return htmlATexto(html.replace(PREHEADER_RE, ""))
}

/** Relleno invisible del preheader: sin él, la bandeja sigue leyendo el cuerpo y lo pega al lado. */
const RELLENO_PREHEADER = "&#8203;&#160;".repeat(60)

function bloquePreheader(preheader: string): string {
  // `display:none` no alcanza —Outlook lo ignora en algunos modos—, de ahí el resto: alto y ancho en
  // cero, `mso-hide` para el motor de Word, y el color igual al fondo como última red.
  const estilo =
    `display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;` +
    `overflow:hidden;mso-hide:all;color:${NIEVE};`
  const texto = escaparHtml(preheader) + RELLENO_PREHEADER
  return `<div ${MARCA_PREHEADER}="1" style="${estilo}">${texto}</div>`
}

function parrafo(texto: string): string {
  const estilo =
    `margin:0 0 16px;font-family:${FUENTE};font-size:16px;line-height:1.6;` +
    `color:${TINTA};background-color:${BLANCO};`
  // Los saltos simples de adentro del párrafo son parte de la redacción ("Factura: FV-1\nVence: …").
  const cuerpo = escaparHtml(texto).replace(/\n/g, "<br>")
  return `<p style="${estilo}">${cuerpo}</p>`
}

function bloqueDeDatos(datos: DatoDelCorreo[] | null | undefined): string {
  if (!datos || datos.length === 0) return ""
  const filas = datos
    .map((d) => {
      const etiqueta =
        `<td style="padding:8px 12px;font-family:${FUENTE};font-size:14px;line-height:1.4;` +
        `color:${TINTA_SUAVE};background-color:${MENTA_CLARA};">${escaparHtml(d.etiqueta)}</td>`
      const valor =
        `<td align="right" style="padding:8px 12px;font-family:${FUENTE};font-size:14px;` +
        `line-height:1.4;font-weight:600;color:${TINTA};background-color:${MENTA_CLARA};">` +
        `${escaparHtml(d.valor)}</td>`
      return `<tr>${etiqueta}${valor}</tr>`
    })
    .join("")
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
    `style="width:100%;border-collapse:collapse;background-color:${MENTA_CLARA};` +
    `border-radius:8px;margin:0 0 24px;">${filas}</table>`
  )
}

function bloqueDelBoton(boton: BotonDeCorreo | null | undefined): string {
  if (!boton) return ""
  const texto = escaparHtml(boton.texto)
  const url = urlSegura(boton.url)
  // Sin URL usable no se dibuja un botón que no lleva a ningún lado, pero la dirección se muestra
  // igual como texto: un enlace roto es un error del sitio que llama, y esconderlo no lo arregla.
  if (!url) return parrafo(`${boton.texto}: ${boton.url}`)
  const href = escaparHtml(url)

  const anchor =
    `<a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${FUENTE};` +
    `font-size:16px;font-weight:600;line-height:1;color:${BLANCO};text-decoration:none;">` +
    `${texto}</a>`
  const boton_ =
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">` +
    `<tr><td align="center" bgcolor="${MENTA}" style="background-color:${MENTA};border-radius:8px;">` +
    `${anchor}</td></tr></table>`

  // La dirección escrita. Doble motivo: es lo único que sobrevive a la versión en texto plano, y es
  // la salida del que abre el correo en un cliente que le comió el botón.
  const respaldo =
    `<p style="margin:0 0 16px;font-family:${FUENTE};font-size:13px;line-height:1.5;` +
    `color:${TINTA_SUAVE};background-color:${BLANCO};">` +
    `Si el botón no funciona, copiá este enlace: ` +
    `<a href="${href}" style="color:${MENTA_OSCURA};text-decoration:underline;">${href}</a></p>`

  return boton_ + respaldo
}

function lineaDePie(linea: LineaDePie): string {
  const estilo =
    `margin:0 0 6px;font-family:${FUENTE};font-size:12px;line-height:1.5;` +
    `color:${TINTA_SUAVE};background-color:${NIEVE};`
  if (typeof linea === "string") {
    return `<p style="${estilo}">${escaparHtml(linea).replace(/\n/g, "<br>")}</p>`
  }
  const url = urlSegura(linea.url)
  if (!url) return `<p style="${estilo}">${escaparHtml(`${linea.texto} ${linea.url}`)}</p>`
  const href = escaparHtml(url)
  return (
    `<p style="${estilo}">${escaparHtml(linea.texto)} ` +
    `<a href="${href}" style="color:${MENTA_OSCURA};text-decoration:underline;">${href}</a></p>`
  )
}

/**
 * El correo entero, listo para mandar como `html`.
 *
 * El texto plano NO se escribe: se deriva de esta misma salida en el transporte. Ver `textoDelCorreo`.
 */
export function maquetarCorreo(correo: CorreoMaquetado): string {
  const titulo = escaparHtml(correo.titulo)

  const contenido = [
    `<h1 style="margin:0 0 20px;font-family:${FUENTE};font-size:22px;line-height:1.3;` +
      `font-weight:700;color:${TINTA};background-color:${BLANCO};">${titulo}</h1>`,
    ...correo.parrafos.filter((p) => p.trim()).map(parrafo),
    bloqueDeDatos(correo.datos),
    bloqueDelBoton(correo.boton),
  ]
    .filter(Boolean)
    // El salto entre bloques es DEL TEXTO PLANO, no del HTML: ahí es espacio en blanco que el
    // cliente ignora, pero al derivar el texto es lo que separa un párrafo del siguiente con un
    // renglón vacío. Sin él, la versión en texto llega como un bloque corrido.
    .join("\n")

  const pie = [
    ...(correo.pie ?? []).map(lineaDePie),
    // La firma de la plataforma va SIEMPRE, también cuando el correo lo firma una clínica: quien lo
    // recibe tiene derecho a saber desde qué sistema le están escribiendo.
    `<p style="margin:12px 0 0;font-family:${FUENTE};font-size:12px;line-height:1.5;` +
      `color:${TINTA_SUAVE};background-color:${NIEVE};">` +
      `Tuvetia · software para clínicas veterinarias</p>`,
  ].join("")

  // La franja de marca es un `border-top` de la tarjeta y NO una fila con un `&nbsp;` adentro, que
  // es como se hace habitualmente. Motivo: esa fila existiría sólo para tener alto, y al derivar el
  // texto plano dejaría un renglón con un espacio duro suelto arriba de todo el correo.
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${titulo}</title>
<style>
/* SÓLO MEJORAS. Gmail en su app tira este bloque entero: nada de acá puede ser necesario para que
   el correo se lea. El ancho fijo de 600px ya está en el atributo y en el estilo en línea. */
@media only screen and (max-width:620px){
  .tv-caja{width:100% !important;}
  .tv-tarjeta{padding:24px 20px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;width:100%;background-color:${NIEVE};color:${TINTA};">
${bloquePreheader(correo.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background-color:${NIEVE};">
<tr>
<td align="center" style="padding:24px 12px;background-color:${NIEVE};">
<table role="presentation" class="tv-caja" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;border-collapse:collapse;">
<tr>
<td style="padding:0 4px 14px;background-color:${NIEVE};font-family:${FUENTE};font-size:20px;line-height:1.2;font-weight:700;letter-spacing:-0.02em;color:${MENTA_OSCURA};">Tuvetia</td>
</tr>
<tr>
<td class="tv-tarjeta" style="padding:32px;background-color:${BLANCO};border:1px solid ${MENTA_CLARA};border-top:4px solid ${MENTA};border-radius:10px;">
${contenido}
</td>
</tr>
<tr>
<td style="padding:20px 4px 0;background-color:${NIEVE};">
${pie}
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`
}
