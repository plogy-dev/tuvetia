/**
 * Las plantillas de cobranza, de cada clínica.
 *
 * LO QUE SE PROTEGE es que un mensaje que SALE pueda además SERVIR. Un recordatorio sin `{number}`
 * o sin `{link}` se envía igual, se ve bien en la caja de texto y el envío queda en ENVIADO — pero
 * el titular no sabe de qué factura le hablan ni por dónde pagar. Nadie lo nota desde adentro: se
 * descubre por los titulares llamando, o por la cartera que no baja.
 */
import { describe, expect, it } from "vitest"

import {
  LARGO_MAXIMO,
  PLANTILLAS_POR_DEFECTO,
  huecosDe,
  leerPlantillas,
  llenarPlantilla,
  plantillaDe,
  revisarPlantilla,
} from "@/lib/cartera/plantillas"

const VALORES = { number: "SETP-1024", balance: "$ 120.000", link: "https://tuvetia.co/f/abc" }

describe("los textos por defecto", () => {
  it("todos pasan su propia revisión", () => {
    // Si un texto por defecto no pasara, la clínica que abre la pantalla y guarda sin tocar nada
    // se comería un error por algo que no escribió.
    for (const [paso, texto] of Object.entries(PLANTILLAS_POR_DEFECTO)) {
      expect(revisarPlantilla(texto), `«${paso}»`).toBeNull()
    }
  })

  it("un paso sin plantilla propia cae al de por defecto", () => {
    expect(plantillaDe({}, "RECORDATORIO_1")).toBe(PLANTILLAS_POR_DEFECTO.RECORDATORIO_1)
  })

  it("y con plantilla propia, manda la de la clínica", () => {
    const mia = "Hola, le escribimos por su factura {number}: {link}"
    expect(plantillaDe({ RECORDATORIO_1: mia }, "RECORDATORIO_1")).toBe(mia)
  })
})

describe("revisarPlantilla", () => {
  it("acepta un texto propio con los dos huecos que importan", () => {
    expect(revisarPlantilla("Hola 🐾 su factura {number} está lista: {link}")).toBeNull()
  })

  it("RECHAZA el texto sin {number}", () => {
    const problema = revisarPlantilla("Tiene una factura vencida. Pague acá: {link}")
    expect(problema).toContain("{number}")
    expect(problema).toContain("no sabe de cuál")
  })

  it("RECHAZA el texto sin {link}", () => {
    const problema = revisarPlantilla("Su factura {number} está vencida por {balance}.")
    expect(problema).toContain("{link}")
    expect(problema).toContain("sin decirle dónde")
  })

  it("nombra LOS DOS cuando faltan los dos", () => {
    const problema = revisarPlantilla("Tiene un saldo pendiente con nosotros.")
    expect(problema).toContain("{number}")
    expect(problema).toContain("{link}")
  })

  it("NO exige {balance} — el saldo se ve al abrir el enlace", () => {
    // Exigirlo sería mandar sobre el tono, que es lo que esta pantalla viene a devolver.
    expect(revisarPlantilla("Le recordamos su factura {number}: {link}")).toBeNull()
  })

  it("RECHAZA un hueco que no existe, y lo nombra", () => {
    // `{nombre}` parece razonable y saldría con sus llaves en el teléfono del titular.
    const problema = revisarPlantilla("Hola {nombre}, su factura {number}: {link}")
    expect(problema).toContain("{nombre}")
    expect(problema).toContain("tal cual")
  })

  it("rechaza el vacío y el de puros espacios", () => {
    expect(revisarPlantilla("")).toContain("vacío")
    expect(revisarPlantilla("    ")).toContain("vacío")
  })

  it("rechaza lo que se pasa de largo", () => {
    const largo = `{number} {link} ` + "a".repeat(LARGO_MAXIMO)
    expect(revisarPlantilla(largo)).toContain("caracteres")
  })
})

describe("llenarPlantilla", () => {
  it("reemplaza los tres huecos", () => {
    expect(llenarPlantilla("F {number} · {balance} · {link}", VALORES)).toBe(
      "F SETP-1024 · $ 120.000 · https://tuvetia.co/f/abc",
    )
  })

  it("REEMPLAZA TODAS LAS APARICIONES, no sólo la primera", () => {
    // `String.replace` con una cadena cambia sólo la primera. Con las plantillas escritas a mano
    // nunca se notó —cada hueco salía una vez— pero en cuanto el vet las escribe, repetir el enlace
    // deja de ser raro, y el segundo saldría impreso con sus llaves.
    const texto = "Pague en {link} o reenvíe {link} a quien corresponda. Factura {number}."
    const salida = llenarPlantilla(texto, VALORES)
    expect(salida).not.toContain("{link}")
    expect(salida.match(/https:\/\/tuvetia\.co\/f\/abc/g)).toHaveLength(2)
  })

  it("no toca un hueco que no conoce", () => {
    // No debería llegar acá —`revisarPlantilla` lo rechaza al guardar— pero si una fila vieja lo
    // trae, se deja como está en vez de romper el envío.
    expect(llenarPlantilla("{number} {mascota}", VALORES)).toBe("SETP-1024 {mascota}")
  })

  it("un valor con signos de dólar no se interpreta como referencia de reemplazo", () => {
    // `$&` y `$1` tienen significado en el reemplazo de `String.replace`. El saldo colombiano
    // SIEMPRE trae un `$`, así que esto no es teórico: es todos los mensajes.
    expect(llenarPlantilla("Saldo {balance} de {number}: {link}", VALORES)).toContain("$ 120.000")
    expect(
      llenarPlantilla("{balance}", { ...VALORES, balance: "$& $1 $$" }),
    ).toBe("$& $1 $$")
  })
})

describe("leerPlantillas — la columna jsonb puede traer cualquier cosa", () => {
  it("lee lo que tiene forma de plantilla", () => {
    expect(leerPlantillas({ RECORDATORIO_1: "Su factura {number}: {link}" })).toEqual({
      RECORDATORIO_1: "Su factura {number}: {link}",
    })
  })

  it("ignora claves que no son pasos y valores que no son texto", () => {
    expect(
      leerPlantillas({ RECORDATORIO_1: 42, INVENTADO: "hola", AVISO_SALDO: "  {number} {link}  " }),
    ).toEqual({ AVISO_SALDO: "{number} {link}" })
  })

  it("un json que no es un objeto no rompe nada: se cae a los textos por defecto", () => {
    // Un recordatorio que no sale por un json raro es plata que no se cobra.
    for (const basura of [null, undefined, 42, "texto", [], [1, 2]]) {
      expect(leerPlantillas(basura), `${JSON.stringify(basura)}`).toEqual({})
    }
  })
})

describe("huecosDe", () => {
  it("los lista sin repetir", () => {
    expect(huecosDe("{a} {b} {a}")).toEqual(["a", "b"])
  })

  it("no confunde llaves sueltas ni contenido raro", () => {
    expect(huecosDe("un { suelto y {2malo} y {bien}")).toEqual(["bien"])
  })
})
