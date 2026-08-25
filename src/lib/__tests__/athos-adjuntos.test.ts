/**
 * Adjuntos del chat de Athos — la parte PURA de la cascada de costos.
 *
 * `textoUtilDePdf` es la compuerta que decide si un PDF se queda en la fase gratis (pdfjs) o cae
 * al lector con IA (que cuesta una llamada de visión por documento). Estos tests fijan el sesgo
 * de diseño: ante la duda, la fase gratis — el error de pagar por un PDF que ya traía texto no lo
 * ve nadie y se paga siempre; el error contrario lo ve el vet en el chat y puede reintentar.
 *
 * `mediaTypeDeImagen` es el espejo del enum del route /api/athos/leer-documento: decide qué
 * extensiones van DIRECTO a la ruta de visión (una foto no tiene fase gratis posible).
 */
import { describe, expect, it } from "vitest"

import { bloqueDeAdjuntos, mediaTypeDeImagen, textoUtilDePdf } from "@/lib/athos-adjuntos"

describe("textoUtilDePdf — la compuerta entre la fase gratis y la fase paga", () => {
  it("un PDF digital normal (cientos de caracteres por página) se queda en la fase gratis", () => {
    const pagina = "Hemograma completo. Eritrocitos 6.8 M/µL (5.5-8.5). Hematocrito 45% (37-55). ".repeat(5)
    expect(textoUtilDePdf(pagina, 1)).toBe(true)
    expect(textoUtilDePdf(`${pagina}\n\n${pagina}`, 2)).toBe(true)
  })

  it("un escaneado (texto vacío o migajas) cae al lector con IA", () => {
    expect(textoUtilDePdf("", 3)).toBe(false)
    expect(textoUtilDePdf("   \n \n ", 2)).toBe(false)
    // Migajas típicas de un escaneado: números de página y un membrete a medias.
    expect(textoUtilDePdf("1\n2\n3\nLab Vet", 3)).toBe(false)
  })

  it("mucho texto total pero diluido en muchas páginas (promedio pobre) también cae a la IA", () => {
    // 40 chars/página en 10 páginas: 400 chars pasan el mínimo absoluto, pero el promedio delata
    // que la mayoría de las páginas está vacía (escaneado con una página de texto suelta).
    const texto = "encabezado corto de veinte letras".repeat(12) // ~400 chars
    expect(textoUtilDePdf(texto, 20)).toBe(false)
  })

  it("el mínimo absoluto manda aunque el promedio dé: 100 chars en 1 página no alcanzan", () => {
    expect(textoUtilDePdf("a".repeat(100), 1)).toBe(false)
    expect(textoUtilDePdf("a".repeat(130), 1)).toBe(true)
  })
})

describe("mediaTypeDeImagen — qué extensiones van directo a la ruta de visión", () => {
  it("mapea cada extensión soportada a su media_type (jpg y jpeg comparten el suyo)", () => {
    expect(mediaTypeDeImagen("jpg")).toBe("image/jpeg")
    expect(mediaTypeDeImagen("jpeg")).toBe("image/jpeg")
    expect(mediaTypeDeImagen("png")).toBe("image/png")
    expect(mediaTypeDeImagen("webp")).toBe("image/webp")
  })

  it("lo que no es imagen soportada devuelve null y sigue por las ramas de texto", () => {
    // pdf/docx tienen su propia rama; gif/tiff/heic NO están en el enum del route — si esto
    // devolviera un media_type, el route lo rechazaría con un 400 críptico en vez del error claro.
    expect(mediaTypeDeImagen("pdf")).toBeNull()
    expect(mediaTypeDeImagen("docx")).toBeNull()
    expect(mediaTypeDeImagen("gif")).toBeNull()
    expect(mediaTypeDeImagen("heic")).toBeNull()
    expect(mediaTypeDeImagen("")).toBeNull()
  })
})

describe("bloqueDeAdjuntos — el prefijo que viaja delante de la pregunta", () => {
  it("cada documento va con su nombre y su contenido entre triple comilla", () => {
    const bloque = bloqueDeAdjuntos([
      { nombre: "lab.pdf", texto: "Hematocrito 45%" },
      { nombre: "dieta.txt", texto: "Renal, 2 tomas" },
    ])
    expect(bloque).toContain('[Documento adjunto: lab.pdf]\n"""\nHematocrito 45%\n"""')
    expect(bloque).toContain('[Documento adjunto: dieta.txt]\n"""\nRenal, 2 tomas\n"""')
    // El colapso de la burbuja del chat depende de este formato exacto (assistant.tsx).
    expect(bloque.match(/\[Documento adjunto: [^\]]+\]\n"""\n[\s\S]*?\n"""/g)).toHaveLength(2)
  })
})
