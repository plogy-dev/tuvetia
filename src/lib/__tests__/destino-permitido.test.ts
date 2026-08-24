/**
 * A quién puede escribirle ATHOS por WhatsApp.
 *
 * LA REGLA: el WhatsApp es de la clínica, así que **el veterinario le escribe a quien quiera**.
 * Athos sólo a titulares registrados.
 *
 * LO QUE ESTOS TESTS PROTEGEN son los dos errores posibles, que duelen en direcciones opuestas:
 *
 *   · SI DEJA PASAR DE MÁS → Athos le escribe a gente que no tiene nada que ver con la clínica.
 *     Contado por Felipe en la reunión del 21-ago: *"le metí una gente en su WhatsApp y empezó a
 *     escribir a la loca, casi me despiden"*.
 *
 *   · SI BLOQUEA DE MÁS → Athos no puede escribirle a un titular REAL. Y ese es el caso probable,
 *     porque el mismo número vive escrito de cuatro formas: 36 de los 41 titulares del principal
 *     tienen el teléfono con formato (`+57 324 466 9300`), y la comparación exacta fallaría con
 *     todos ellos.
 *
 * Por eso el grueso de la tabla son formatos.
 */

import { describe, expect, it } from "vitest"

import { claveDeTelefono, esDestinoRegistrado } from "@/lib/whatsapp/destino-permitido"

describe("la clave con la que se comparan los teléfonos", () => {
  it("son los últimos 10 dígitos", () => {
    expect(claveDeTelefono("573244669300")).toBe("3244669300")
    expect(claveDeTelefono("3244669300")).toBe("3244669300")
  })

  // 36 de los 41 titulares del principal tienen el teléfono con formato.
  it("ignora espacios, signos y paréntesis", () => {
    expect(claveDeTelefono("+57 324 466 9300")).toBe("3244669300")
    expect(claveDeTelefono("(324) 466-9300")).toBe("3244669300")
  })

  // Un teléfono basura no puede abrir la puerta por coincidir con otro basura.
  it("lo que no tiene 10 dígitos no es una clave", () => {
    expect(claveDeTelefono("123")).toBe("")
    expect(claveDeTelefono("")).toBe("")
    expect(claveDeTelefono(null)).toBe("")
    expect(claveDeTelefono(undefined)).toBe("")
  })
})

describe("a quién puede escribirle Athos", () => {
  const TITULARES = ["+57 324 466 9300", "3105551234", "573001112233"]

  // EL CASO QUE MÁS DUELE SI FALLA: el mismo número escrito distinto en los dos lados.
  it("un titular pasa aunque esté guardado con otro formato", () => {
    expect(esDestinoRegistrado("573244669300", TITULARES)).toBe(true)
    expect(esDestinoRegistrado("3244669300", TITULARES)).toBe(true)
    expect(esDestinoRegistrado("+57 324 466 9300", TITULARES)).toBe(true)
  })

  it("los tres formatos de la lista se reconocen igual", () => {
    expect(esDestinoRegistrado("573105551234", TITULARES)).toBe(true)
    expect(esDestinoRegistrado("573001112233", TITULARES)).toBe(true)
  })

  // EL CASO QUE MÁS DUELE SI PASA: el número que Athos se inventó.
  it("un desconocido NO pasa", () => {
    expect(esDestinoRegistrado("573009998877", TITULARES)).toBe(false)
  })

  it("sin nadie registrado, nadie pasa", () => {
    expect(esDestinoRegistrado("573244669300", [])).toBe(false)
  })

  // Un `phone` vacío en la base no puede volverse un comodín que deje pasar cualquier cosa.
  it("un teléfono vacío en la lista no habilita a nadie", () => {
    expect(esDestinoRegistrado("573244669300", ["", "   ", null as unknown as string])).toBe(false)
  })

  it("un destino sin dígitos suficientes no pasa aunque la lista tenga basura igual", () => {
    expect(esDestinoRegistrado("123", ["123"])).toBe(false)
  })

  // No alcanza con que el número CONTENGA la clave: tiene que terminar en ella. Si no, un número
  // largo cualquiera que incluyera esos dígitos en el medio pasaría.
  it("compara por el final, no por 'contiene'", () => {
    expect(esDestinoRegistrado("3244669300", ["3244669300999"])).toBe(false)
  })
})

describe("el origen se declara y por defecto es el lado seguro", () => {
  // ESTE ES EL TEST QUE MÁS IMPORTA DE LA GUARDA, y no prueba código: prueba una decisión.
  //
  // `sendWhatsAppText` restringe cuando `origen` es `"athos"`, Y CUANDO NO VIENE. Así, quien agregue
  // un sexto camino de salida y se olvide del parámetro se lo encuentra restringido en vez de
  // abierto. Si el default fuera `"humano"`, el olvido abriría el cerco sin que nadie lo note —
  // que es exactamente cómo se pierden las guardas.
  //
  // Se lee del archivo por la misma razón que `onboarding-tour-anclas`: la alternativa es montar
  // Supabase y el proveedor de WhatsApp para verificar un `??`.
  it("`sendWhatsAppText` trata la ausencia de origen como athos", async () => {
    const { readFileSync } = await import("node:fs")
    const fuente = readFileSync("src/lib/whatsapp/send-message.ts", "utf8")
    expect(fuente).toMatch(/\(opts\.origen \?\? "athos"\) === "athos"/)
  })

  // La bandeja es el único sitio donde una PERSONA elige el destinatario.
  it("la bandeja es el único que declara origen humano", async () => {
    const { readFileSync } = await import("node:fs")
    const bandeja = readFileSync("src/app/api/whatsapp/send/route.ts", "utf8")
    expect(bandeja).toMatch(/origen: "humano"/)

    // Y los caminos de Athos lo declaran explícito, aunque el default ya los cubriría: en un sitio
    // de envío, leer el origen en la llamada vale más que confiar en un default de otro archivo.
    for (const f of [
      "src/lib/whatsapp/auto-reply.ts",
      "src/lib/cartera/wa-router.ts",
      "src/lib/cartera/channels.ts",
      "src/app/api/athos/actions/[id]/execute/route.ts",
    ]) {
      expect(readFileSync(f, "utf8"), f).toMatch(/origen: ["']athos["']/)
    }
  })
})
