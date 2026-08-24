/**
 * Las plantillas del envío masivo, y el hueco sin rellenar.
 *
 * EL DEFECTO QUE ESTO IMPIDE es "Hola {{nombre}}," salido a doce clínicas. Es el error clásico de
 * cualquier sistema de plantillas y tiene una razón concreta: quien redacta lee lo que quiso
 * escribir, no lo que escribió. Un masivo no se puede deshacer.
 *
 * LA PROPIEDAD QUE MÁS IMPORTA está en el último bloque: la vista previa y el envío tienen que
 * pasar por la MISMA función. Un preview que se arma distinto del envío miente, y se firma la
 * salida confiando en él — es peor que no tener preview.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  PLANTILLAS,
  huecos,
  listoParaEnviar,
  plantillaPorId,
  rellenar,
} from "@/lib/email/plantillas"

describe("los huecos de una plantilla", () => {
  it("los encuentra en el asunto Y en el cuerpo", () => {
    // Los dos viajan al destinatario. Mirar sólo el cuerpo deja pasar un asunto roto, que además es
    // lo primero que se ve en la bandeja.
    expect(huecos("Mantenimiento el {{fecha}}", "de {{desde}} a {{hasta}}")).toEqual([
      "fecha", "desde", "hasta",
    ])
  })

  it("no repite y tolera los espacios de adentro", () => {
    expect(huecos("{{ fecha }} y {{fecha}}")).toEqual(["fecha"])
  })

  it("un texto ya resuelto no tiene huecos", () => {
    expect(huecos("Mantenimiento el martes", "de 9 a 11")).toEqual([])
  })
})

describe("rellenar", () => {
  it("reemplaza lo que tiene valor", () => {
    expect(rellenar("Hola {{nombre}}, el {{fecha}}", { nombre: "Ana", fecha: "martes" }))
      .toBe("Hola Ana, el martes")
  })

  it("UN VALOR EN BLANCO NO CUENTA COMO RELLENO", () => {
    // Si el blanco reemplazara, saldría "Hola ," — que pasa toda validación de "no está vacío" y
    // llega igual de mal. Dejando la marca, `huecos()` lo sigue viendo y el envío sigue bloqueado.
    expect(rellenar("Hola {{nombre}},", { nombre: "   " })).toBe("Hola {{nombre}},")
    expect(listoParaEnviar("x", rellenar("Hola {{nombre}},", { nombre: "" }))).toBe(false)
  })

  it("el hueco que nadie llenó queda VISIBLE, no desaparece", () => {
    // Que se vea es la única forma de que alguien lo note en la vista previa.
    expect(rellenar("Hola {{nombre}}, el {{fecha}}", { fecha: "martes" }))
      .toBe("Hola {{nombre}}, el martes")
  })

  it("una variable de más no ensucia el texto", () => {
    expect(rellenar("Hola {{nombre}}", { nombre: "Ana", sobra: "x" })).toBe("Hola Ana")
  })
})

describe("el catálogo", () => {
  it("todas las plantillas declaran para qué son", () => {
    // El selector muestra `para` debajo: sin eso se elige por el título, que es como se manda un
    // aviso de incidencia cuando lo que había era un mantenimiento.
    for (const p of PLANTILLAS) {
      expect(p.para.length, `${p.id} sin explicación de uso`).toBeGreaterThan(20)
      expect(p.asunto.trim()).not.toBe("")
      expect(p.cuerpo.trim()).not.toBe("")
    }
  })

  it("los ids no se repiten", () => {
    expect(new Set(PLANTILLAS.map((p) => p.id)).size).toBe(PLANTILLAS.length)
  })

  it("ninguna es comercial: el alcance es avisos operativos", () => {
    // No es puritanismo: el contenido comercial exige base legal (Ley 1581), enlace de baja y
    // registro de consentimiento, y nada de eso está construido. Una plantilla de promoción acá
    // sería una invitación a usar el panel para algo que no puede hacer legalmente.
    const prohibido = /descuento|promoci[oó]n|oferta|comprá|comprar ahora|suscribite ya/i
    for (const p of PLANTILLAS) {
      expect(prohibido.test(`${p.nombre} ${p.asunto} ${p.cuerpo}`), `${p.id} suena comercial`).toBe(false)
    }
  })

  it("se busca por id", () => {
    expect(plantillaPorId("mantenimiento")?.nombre).toBe("Mantenimiento programado")
    expect(plantillaPorId("no-existe")).toBeUndefined()
  })
})

describe("la vista previa y el envío no pueden divergir", () => {
  it("toda plantilla del catálogo queda lista cuando se llenan sus huecos", () => {
    // Recorre el catálogo entero: una plantilla con una marca rara —`{{ fecha-larga }}`, con guion—
    // no la detectaría `huecos()`, se mostraría como texto en la vista previa y saldría así.
    for (const p of PLANTILLAS) {
      const valores = Object.fromEntries(huecos(p.asunto, p.cuerpo).map((h) => [h, `<${h}>`]))
      const asunto = rellenar(p.asunto, valores)
      const cuerpo = rellenar(p.cuerpo, valores)
      expect(listoParaEnviar(asunto, cuerpo), `${p.id} queda con huecos tras rellenar todo`).toBe(true)
      expect(cuerpo).not.toMatch(/\{\{|\}\}/)
    }
  })

  it("`listoParaEnviar` es lo mismo que mirar los huecos", () => {
    // La UI deshabilita con esto y el servidor rechaza con esto. Si fueran dos criterios, habría un
    // texto que la interfaz deja mandar y el servidor rebota, o peor: al revés.
    const casos: [string, string][] = [
      ["Hola", "sin marcas"],
      ["Hola {{a}}", "sin marcas"],
      ["Hola", "con {{b}}"],
    ]
    for (const [asunto, cuerpo] of casos) {
      expect(listoParaEnviar(asunto, cuerpo)).toBe(huecos(asunto, cuerpo).length === 0)
    }
  })
})

describe("el cableado, que es donde esto se rompe de verdad", () => {
  // Los tests de arriba prueban el módulo. Nada de eso impide el defecto que importa: que el panel
  // arme la vista previa con `rellenar` y después mande `subject` y `text` CRUDOS. Compilaría,
  // pasaría todos los tests anteriores, y saldría "Hola {{nombre}}," con una vista previa impecable
  // al lado. Es un acuerdo entre dos archivos, así que se lee el fuente.
  const leer = (rel: string) => readFileSync(join(process.cwd(), "src", ...rel.split("/")), "utf8")

  it("el panel manda el texto RELLENADO, no el crudo", () => {
    const panel = leer("components/admin/bulk-email-panel.tsx")
    expect(panel).toMatch(/subject:\s*asuntoFinal/)
    expect(panel).toMatch(/text:\s*cuerpoFinal/)
    // Y que lo que se manda salga de la misma función que pinta la vista previa.
    expect(panel).toMatch(/rellenar\(/)
  })

  it("el servidor RECHAZA un texto con huecos, sin depender de la pantalla", () => {
    // Una server action es un endpoint: se la puede llamar sin pasar por la interfaz. Si la única
    // validación viviera en el panel, el primer script para la tanda del mes la saltearía.
    const accion = leer("app/admin/usuarios/actions.ts")
    expect(accion).toMatch(/huecos\(/)
    expect(accion).toMatch(/from "@\/lib\/email\/plantillas"/)
  })
})

