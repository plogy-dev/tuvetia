/**
 * La maqueta del correo no se puede probar mirándola: se prueba fijando lo que se rompe en silencio.
 *
 * Un correo mal maquetado NO falla — sale, llega y se ve mal en la bandeja de un cliente al que
 * nadie de este lado tiene abierto. No hay excepción, no hay pantalla roja, no hay línea en el log.
 * Se entera el veterinario, o el titular al que le llegó, o nadie.
 *
 * Por eso lo que fijan estos casos son las cuatro cosas que un cambio bienintencionado rompe sin
 * darse cuenta: el escapado de los datos, el preheader oculto, las variables CSS —que del otro lado
 * no existen— y los colores de marca escritos como literales.
 */
import { describe, expect, it } from "vitest"

import {
  escaparHtml,
  maquetarCorreo,
  parrafosDeTexto,
  textoDelCorreo,
  urlSegura,
} from "../maqueta"

/** Un correo mínimo. Cada caso le cambia sólo lo que va a mirar. */
const base = {
  titulo: "Factura FV-0123",
  preheader: "Su factura ya está disponible",
  parrafos: ["Le compartimos su factura."],
}

describe("los datos no pueden romper la maqueta", () => {
  it("el nombre de un titular con etiquetas HTML llega escapado, no interpretado", () => {
    // `Ana <b>` es un nombre que alguien puede cargar en la ficha, a propósito o de casualidad. Sin
    // escapar, el resto del correo queda en negrita — y ése es el caso benigno.
    const html = maquetarCorreo({
      ...base,
      titulo: "Ana <b>",
      parrafos: ["Hola Ana <b>, le escribimos por su cita."],
    })
    expect(html).toContain("Ana &lt;b&gt;")
    expect(html).not.toContain("Ana <b>")
  })

  it("una comilla doble en un dato no se escapa del atributo donde vive", () => {
    // El título viaja también dentro de `<title>`, y los valores del bloque de datos y del pie
    // terminan pegados a atributos `style`. Una comilla suelta ahí abre un atributo nuevo.
    const html = maquetarCorreo({
      ...base,
      titulo: 'Clínica "La Esquina"',
      datos: [{ etiqueta: 'Pagador "X"', valor: '"1.000"' }],
    })
    expect(html).toContain("&quot;")
    expect(html).not.toContain('Clínica "La Esquina"')
    expect(html).not.toContain('Pagador "X"')
  })

  it("un cierre de etiqueta metido en el cuerpo de un aviso no cierra la tarjeta", () => {
    // El cuerpo del aviso masivo lo redacta una persona en un textarea: es texto de entrada, no
    // una constante del código.
    const html = maquetarCorreo({
      ...base,
      parrafos: ["</td></tr></table><script>alert(1)</script>"],
    })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("el escapado no se muerde la cola: un `&` no se convierte dos veces", () => {
    // Si `<` se escapara antes que `&`, el `&` recién puesto por `&lt;` volvería a escaparse y el
    // destinatario leería `&amp;lt;` en pantalla.
    expect(escaparHtml("a < b & c")).toBe("a &lt; b &amp; c")
    expect(escaparHtml("<")).not.toContain("&amp;lt;")
  })
})

describe("un href sólo acepta direcciones que se puedan seguir", () => {
  it("deja pasar http, https y mailto", () => {
    expect(urlSegura("https://tuvetia.com/f/abc")).toBe("https://tuvetia.com/f/abc")
    expect(urlSegura("http://localhost:3000/invitar/1")).toBe("http://localhost:3000/invitar/1")
    expect(urlSegura("mailto:vet@tuvetia.com")).toBe("mailto:vet@tuvetia.com")
  })

  it("rechaza `javascript:`, incluso partido con un salto de línea", () => {
    // Hay clientes de escritorio que ejecutan un `href` con esquema `javascript:`, y partirlo con un
    // salto o un tabulador es cómo se pasa una comparación de prefijo hecha a la ligera.
    expect(urlSegura("javascript:alert(1)")).toBeNull()
    expect(urlSegura("java\nscript:alert(1)")).toBeNull()
    expect(urlSegura("  JaVaScRiPt:alert(1)")).toBeNull()
    expect(urlSegura("data:text/html,<script>alert(1)</script>")).toBeNull()
  })

  it("un botón con una dirección rechazada no se dibuja como botón, pero no desaparece", () => {
    // Esconder el enlace no arregla el error de quien llamó: lo deja sin diagnóstico y al
    // destinatario sin la acción que el correo venía a pedirle.
    const html = maquetarCorreo({
      ...base,
      boton: { texto: "Ver la factura", url: "javascript:alert(1)" },
    })
    expect(html).not.toContain('href="javascript:')
    expect(html).toContain("Ver la factura")
  })
})

describe("el preheader", () => {
  it("está, y está antes que cualquier otra cosa del cuerpo", () => {
    const html = maquetarCorreo(base)
    expect(html).toContain("Su factura ya está disponible")
    expect(html.indexOf("Su factura ya está disponible")).toBeLessThan(html.indexOf("Tuvetia</td>"))
  })

  it("va oculto: si se ve, aparece un renglón suelto arriba de todo el correo", () => {
    const html = maquetarCorreo(base)
    const bloque = html.slice(html.indexOf("<div data-tv-preheader"))
    expect(bloque).toContain("display:none")
    expect(bloque).toContain("mso-hide:all")
    // `display:none` solo no alcanza: hay clientes que lo ignoran y ahí el alto en cero es lo que
    // sostiene el ocultamiento.
    expect(bloque).toContain("max-height:0")
  })

  it("NO se cuela en la versión en texto plano", () => {
    // Es un resumen del correo, no su primera línea. Sin quitarlo, el que lee en modo texto empieza
    // por una repetición del asunto arrastrando los caracteres invisibles del relleno.
    const texto = textoDelCorreo(maquetarCorreo(base))
    expect(texto).not.toContain("Su factura ya está disponible")
    expect(texto.startsWith("Tuvetia")).toBe(true)
  })
})

describe("el HTML tiene que sobrevivir a un cliente de correo", () => {
  it("no queda ni una variable CSS en la salida", () => {
    // `var(--tv-mint-500)` se resuelve contra `globals.css`, que del otro lado no existe: en Gmail
    // esa declaración se descarta entera y el elemento queda sin color.
    const html = maquetarCorreo({
      ...base,
      datos: [{ etiqueta: "Total", valor: "$120.000" }],
      boton: { texto: "Ver la factura", url: "https://tuvetia.com/f/abc" },
      pie: ["Gracias.", { texto: "Darte de baja:", url: "https://tuvetia.com/baja/t" }],
    })
    expect(html).not.toContain("var(--")
  })

  it("los colores de marca van como literales", () => {
    const html = maquetarCorreo({
      ...base,
      boton: { texto: "Ver la factura", url: "https://tuvetia.com/f/abc" },
    })
    expect(html).toContain("#12856a") // verde de marca — la franja y el relleno del botón
    expect(html).toContain("#0f6e58") // verde oscuro — la firma y los enlaces
    expect(html).toContain("#f5f8f7") // fondo nieve
    expect(html).toContain("#0c1613") // tinta
  })

  it("maqueta con tablas y no con flexbox ni grid", () => {
    // Outlook de escritorio dibuja con el motor de Word, que no conoce ninguno de los dos: un layout
    // moderno no se degrada ahí, se desarma.
    const html = maquetarCorreo(base)
    expect(html).toContain("<table")
    expect(html).not.toContain("display:flex")
    expect(html).not.toContain("display:grid")
  })

  it("se declara pensado en claro, para que el cliente no invierta los colores solo", () => {
    const html = maquetarCorreo(base)
    expect(html).toContain('name="color-scheme" content="light"')
    expect(html).toContain('name="supported-color-schemes" content="light"')
  })

  it("cada celda pinta su fondo: una transparente es la que el modo oscuro da vuelta", () => {
    const html = maquetarCorreo(base)
    for (const celda of html.match(/<td[^>]*>/g) ?? []) {
      expect(celda).toContain("background-color:")
    }
  })

  it("no depende del bloque <style>: ahí sólo van mejoras", () => {
    // Gmail en su app tira el `<head>` entero. Se comprueba mirando el correo SIN ese bloque: los
    // colores y el ancho tienen que seguir estando.
    const html = maquetarCorreo(base).replace(/<style>[\s\S]*?<\/style>/, "")
    expect(html).toContain("#12856a")
    expect(html).toContain("width:600px")
  })
})

describe("la versión en texto plano se deriva del mismo original", () => {
  it("conserva la dirección del botón, que un href solo perdería", () => {
    // `<a href="X">Ver la factura</a>` se convierte en "Ver la factura" y la dirección se evapora.
    // Por eso el botón lleva su URL escrita abajo.
    const html = maquetarCorreo({
      ...base,
      boton: { texto: "Ver la factura", url: "https://tuvetia.com/f/abc123" },
    })
    expect(textoDelCorreo(html)).toContain("https://tuvetia.com/f/abc123")
  })

  const BAJA = "https://tuvetia.com/baja/tok"

  it("conserva el enlace de baja del pie", () => {
    // No es una comodidad: la Ley 1581 le da al titular el derecho a revocar, y si el enlace sólo
    // vive en un `href`, para el que lee en texto plano ese derecho no existe.
    const html = maquetarCorreo({
      ...base,
      pie: [
        { texto: "Si no querés recibir más avisos, date de baja acá:", url: BAJA },
      ],
    })
    expect(textoDelCorreo(html)).toContain(BAJA)
  })

  it("no arrastra el CSS ni el título del <head> al cuerpo", () => {
    const texto = textoDelCorreo(maquetarCorreo(base))
    expect(texto).not.toContain("max-width:620px")
    expect(texto).not.toContain("<")
  })

  it("los datos escapados vuelven a leerse como los escribió quien los cargó", () => {
    const html = maquetarCorreo({ ...base, titulo: 'Ana <b> & "Cía"' })
    expect(textoDelCorreo(html)).toContain('Ana <b> & "Cía"')
  })
})

describe("el cuerpo en texto de los sitios que hoy mandan texto plano", () => {
  it("una línea en blanco separa párrafos; un salto simple queda adentro del párrafo", () => {
    // Es lo que permite maquetar los cuerpos que ya están redactados sin reescribirlos.
    const cuerpo = "Hola,\n\nFactura: FV-1\nVence: 30/09\n\nGracias."
    expect(parrafosDeTexto(cuerpo)).toEqual(["Hola,", "Factura: FV-1\nVence: 30/09", "Gracias."])
  })

  it("el salto simple llega al HTML como <br> y vuelve como salto", () => {
    const html = maquetarCorreo({ ...base, parrafos: ["Factura: FV-1\nVence: 30/09"] })
    expect(html).toContain("Factura: FV-1<br>Vence: 30/09")
    expect(textoDelCorreo(html)).toContain("Factura: FV-1\nVence: 30/09")
  })

  it("las líneas en blanco de más no producen párrafos vacíos", () => {
    expect(parrafosDeTexto("Uno\n\n\n\nDos\n\n   \n\nTres")).toEqual(["Uno", "Dos", "Tres"])
    expect(parrafosDeTexto("   \n\n  ")).toEqual([])
  })
})
