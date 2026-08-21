/**
 * El informe que se lleva el dueño.
 *
 * LO QUE ESTOS TESTS PROTEGEN no es que el texto quede lindo: es que **no salga a la calle nada que
 * un veterinario no haya aprobado**. La nota SOAP se queda adentro del sistema y se puede corregir;
 * este documento se lo lleva el titular en la mano y se lee en la casa, con el animal delante.
 *
 * Por eso las guardas se prueban de a una, y por eso el parser NO rellena lo que falta: un
 * "consulte a su veterinario" puesto por defecto sería una frase que nadie escribió, en un papel
 * que alguien va a seguir.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  comoTextoPlano,
  firmaPorDefecto,
  limpiarInforme,
  pedidoDelInforme,
  sePuedeInformar,
  type InsumosDelInforme,
} from "@/lib/informe-al-titular/armar"

const NOTA_OK = {
  status: "approved",
  subjective: "Paciente presenta hiporexia de 48 horas.",
  objective: "TR 39.8 °C, mucosas rosadas.",
  assessment: "Cuadro compatible con gastroenteritis leve.",
  plan: "Dieta blanda 3 días. Metoclopramida 0.5 mg/kg cada 8h.",
}

const INSUMOS: InsumosDelInforme = {
  nota: NOTA_OK,
  paciente: { nombre: "Manchita", especie: "Canino" },
  titular: { nombre: "José" },
  clinica: "Veterinaria San Roque",
  veterinario: "Dra. Pérez",
  fecha: "20 de agosto de 2026",
}

describe("cuándo se puede entregar un informe", () => {
  it("con la nota aprobada y con contenido, sí", () => {
    expect(sePuedeInformar(NOTA_OK)).toEqual({ puede: true })
  })

  it("con la nota en borrador, NO", () => {
    // REGLA 5 DEL SISTEMA: ninguna nota entra a la historia sin aprobación. Un informe derivado de
    // un borrador se saltearía esa aprobación por la puerta que da a la calle — el borrador se
    // queda adentro, el informe se lo lleva el dueño.
    expect(sePuedeInformar({ ...NOTA_OK, status: "draft" })).toEqual({
      puede: false,
      motivo: "nota-sin-aprobar",
    })
    expect(sePuedeInformar({ ...NOTA_OK, status: "review" }).puede).toBe(false)
  })

  it("sin nota, NO", () => {
    expect(sePuedeInformar(null)).toEqual({ puede: false, motivo: "sin-nota" })
    expect(sePuedeInformar(undefined).puede).toBe(false)
  })

  it("con la nota aprobada pero vacía, NO — y con otro motivo", () => {
    // Los dos noes son distintos y la pantalla tiene que decir cuál: "aprobá la nota" es accionable,
    // "no hay nada que informar" no. Un botón gris sin explicación se lee como que el sistema falla.
    expect(sePuedeInformar({ status: "approved", assessment: "", plan: "  " })).toEqual({
      puede: false,
      motivo: "nota-vacia",
    })
  })

  it("con análisis pero sin plan alcanza", () => {
    expect(sePuedeInformar({ status: "approved", assessment: "Gastroenteritis leve." }).puede).toBe(true)
  })
})

describe("el pedido que se le manda al modelo", () => {
  const pedido = pedidoDelInforme(INSUMOS)

  it("le prohíbe agregar lo que la nota no dice", () => {
    // ES LA FRONTERA QUE HACE SEGURO ENTREGAR ESTO. Si el modelo pudiera agregar, el documento que
    // se lleva el dueño tendría material clínico que nadie revisó.
    expect(pedido).toMatch(/NO agregues diagnósticos, medicamentos, dosis/)
    expect(pedido).toMatch(/Traducís, no completás/)
  })

  it("lleva la nota entera, que es de donde tiene que copiar", () => {
    expect(pedido).toContain("Cuadro compatible con gastroenteritis leve")
    expect(pedido).toContain("Metoclopramida 0.5 mg/kg cada 8h")
  })

  it("nombra al paciente y al titular", () => {
    expect(pedido).toContain("Manchita")
    expect(pedido).toContain("José")
  })

  it("sin nombre del titular, se lo dice en vez de inventarlo", () => {
    // Un "Hola Juan" a alguien que no se llama Juan es peor que un saludo genérico.
    const sinNombre = pedidoDelInforme({ ...INSUMOS, titular: { nombre: null } })
    expect(sinNombre).toMatch(/no tiene nombre registrado/)
  })

  it("no manda secciones vacías de la nota", () => {
    const flaca = pedidoDelInforme({
      ...INSUMOS,
      nota: { status: "approved", assessment: "Gastroenteritis leve." },
    })
    expect(flaca).not.toContain("Hallazgos:")
    expect(flaca).toContain("Análisis:")
  })
})

describe("partir la respuesta del modelo", () => {
  const CRUDO = `ASUNTO: Cómo sigue Manchita
SALUDO: Hola José,
CUERPO: Manchita llegó sin ganas de comer desde hace dos días.

Lo revisamos y encontramos una irritación del estómago, de las que se pasan.
PLAN:
- Comida blanda por 3 días
- Una pastilla cada 8 horas
ALERTAS:
- Si vomita más de dos veces
- Si deja de tomar agua`

  it("saca cada sección donde va", () => {
    const i = limpiarInforme(CRUDO, "Dra. Pérez")
    expect(i.subject).toBe("Cómo sigue Manchita")
    expect(i.salutation).toBe("Hola José,")
    expect(i.body).toContain("sin ganas de comer")
    expect(i.body).toContain("irritación del estómago")
    expect(i.plan).toContain("Comida blanda")
    expect(i.warnings).toContain("deja de tomar agua")
    expect(i.signature).toBe("Dra. Pérez")
  })

  it("el cuerpo no se come al plan", () => {
    // El corte va contra CUALQUIER otra etiqueta. Sin eso, "CUERPO" se llevaba todo hasta el final
    // y el informe salía con el plan repetido adentro del cuerpo y la sección de plan vacía.
    const i = limpiarInforme(CRUDO, "")
    expect(i.body).not.toContain("Comida blanda")
    expect(i.body).not.toContain("ALERTAS")
  })

  it("aguanta las etiquetas decoradas con markdown", () => {
    // El modelo devuelve `**ASUNTO:**` bastante más seguido de lo que promete.
    const i = limpiarInforme("**ASUNTO:** Manchita\n**CUERPO:**\nTodo bien.", "")
    expect(i.subject).toBe("Manchita")
    expect(i.body).toBe("Todo bien.")
  })

  it("aguanta que vengan desordenadas", () => {
    const i = limpiarInforme("CUERPO: Todo bien.\nASUNTO: Manchita", "")
    expect(i.subject).toBe("Manchita")
    expect(i.body).toBe("Todo bien.")
  })

  it("lo que falta queda VACÍO, no relleno", () => {
    // NO SE INVENTA CONTENIDO. Un texto por defecto serían palabras que nadie escribió en un papel
    // que alguien va a seguir con un animal enfermo delante. Vacío se ve, y el vet lo escribe.
    const i = limpiarInforme("ASUNTO: Manchita", "")
    expect(i.body).toBe("")
    expect(i.plan).toBe("")
    expect(i.warnings).toBe("")
  })

  it("con basura devuelve todo vacío en vez de reventar", () => {
    const i = limpiarInforme("", "firma")
    expect(i.body).toBe("")
    expect(i.signature).toBe("firma")
  })
})

describe("el mismo informe, compuesto de dos formas", () => {
  it("el texto plano lleva las secciones con su título", () => {
    const plano = comoTextoPlano({
      subject: "Cómo sigue Manchita",
      salutation: "Hola José,",
      body: "Todo bien.",
      plan: "- Comida blanda",
      warnings: "- Si vomita",
      signature: "Dra. Pérez",
    })
    expect(plano).toContain("Hola José,")
    expect(plano).toContain("Qué hacer en casa:")
    expect(plano).toContain("Cuándo volver de urgencia:")
    expect(plano).toContain("Dra. Pérez")
    // El asunto NO va en el cuerpo del mensaje: es el asunto, no la primera línea.
    expect(plano).not.toContain("Cómo sigue Manchita")
  })

  it("una sección vacía no deja su título huérfano", () => {
    const plano = comoTextoPlano({
      subject: "x",
      salutation: "Hola,",
      body: "Todo bien.",
      plan: "",
      warnings: "",
      signature: "",
    })
    expect(plano).not.toContain("Qué hacer en casa")
    expect(plano).not.toContain("Cuándo volver")
  })

  it("no deja tres saltos de línea seguidos", () => {
    const plano = comoTextoPlano({
      subject: "x",
      salutation: "Hola,",
      body: "A.",
      plan: "",
      warnings: "- B",
      signature: "F",
    })
    expect(plano).not.toMatch(/\n{3}/)
  })

  it("la firma junta al vet con la clínica, y aguanta que falte uno", () => {
    expect(firmaPorDefecto("Dra. Pérez", "San Roque")).toBe("Dra. Pérez · San Roque")
    expect(firmaPorDefecto(null, "San Roque")).toBe("San Roque")
    expect(firmaPorDefecto(null, null)).toBe("")
  })
})

// ── Lo que ningún test de unidad puede ver ──────────────────────────────────────────────────────

describe("la nota aprobada como condición dura", () => {
  it("la migración lo impone con un trigger, no sólo la UI", () => {
    // La tabla se escribe desde el cliente con RLS: nada impide un insert a mano. Un botón gris es
    // una cortesía, no una garantía.
    const sql = readFileSync(
      join(process.cwd(), "athos-service", "supabase", "migrations", "0071_informe_al_titular.sql"),
      "utf8",
    )
    expect(sql).toMatch(/status = 'approved'/)
    expect(sql).toMatch(/create trigger client_reports_nota_aprobada/)
    // Y el registro de auditoría no se borra: sin policy de delete.
    expect(sql).not.toMatch(/for delete/)
  })
})

describe("las guardas del lado del servidor", () => {
  const leer = (ruta: string) =>
    readFileSync(join(process.cwd(), "src", ruta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")

  const RUTA = leer("app/api/informe-al-titular/route.ts")

  it("no gasta un token sin sesión, sin nota aprobada y sin cupo", () => {
    // EL ORDEN IMPORTA Y ES EL DEL ARCHIVO: las guardas baratas primero. Preguntar por el cupo
    // cuesta una consulta; llamar al modelo cuesta plata. Si `generateText` subiera por encima de
    // cualquiera de las tres, la clínica pagaría llamadas que igual se van a rechazar.
    // SE MIDE SOBRE EL CUERPO, no sobre el archivo: arriba está el bloque de imports, que nombra
    // las mismas funciones en otro orden. La primera versión de este chequeo comparaba contra el
    // `import` de `consultarPresupuesto` y daba un orden que no existe en el código que corre.
    const cuerpo = RUTA.slice(RUTA.indexOf("export async function POST"))
    const iSesion = cuerpo.indexOf("auth.getUser()")
    const iNota = cuerpo.indexOf("sePuedeInformar(")
    const iCupo = cuerpo.indexOf("consultarPresupuesto(")
    const iModelo = cuerpo.indexOf("generateText(")
    expect(iSesion).toBeGreaterThan(-1)
    expect(iNota).toBeGreaterThan(iSesion)
    expect(iCupo).toBeGreaterThan(iNota)
    expect(iModelo).toBeGreaterThan(iCupo)
  })

  it("registra el gasto en su propia superficie", () => {
    // Metido dentro de `agent` no se podría contestar cuánto cuesta que cada consulta termine con
    // un informe — que es la cifra que decide si esto se regala o se cobra.
    expect(RUTA).toContain("registrarUso")
    expect(RUTA).toMatch(/surface:\s*"informe_titular"/)
  })

  it("la ruta NO guarda el informe", () => {
    // Lo que se guarda es lo que el vet aprueba DESPUÉS de editar. Si la ruta insertara el borrador,
    // el registro de auditoría diría lo que escribió el modelo y no lo que se llevó el dueño.
    expect(RUTA).not.toMatch(/from\("client_reports"\)/)
  })

  it("el PDF imprime lo guardado, no un borrador nuevo", () => {
    // Es el punto entero de que la tabla exista: si el titular vuelve con el papel, hay que poder
    // reimprimir ESE papel. Un documento que se regenera no puede responder qué decía.
    const pdf = leer("app/dashboard/consultas/[id]/informe/page.tsx")
    expect(pdf).toMatch(/from\("client_reports"\)/)
    expect(pdf).not.toContain("generateText")
    expect(pdf).toMatch(/order\("sent_at", \{ ascending: false \}\)/)
  })

  it("el diálogo registra la entrega ANTES de abrir el PDF", () => {
    // Al revés, una pestaña bloqueada por el navegador dejaría al vet creyendo que entregó algo que
    // no quedó registrado — y la auditoría vale por lo que no se puede olvidar de anotar.
    const dialogo = leer("components/consultas/informe-al-titular.tsx")
    const iRegistro = dialogo.indexOf('await registrar("pdf")')
    const iAbrir = dialogo.indexOf("window.open(")
    expect(iRegistro).toBeGreaterThan(-1)
    expect(iAbrir).toBeGreaterThan(iRegistro)
  })

  it("el botón exige la nota aprobada", () => {
    expect(leer("app/dashboard/consultas/[id]/page.tsx")).toMatch(/disabled=\{!approved\}/)
  })
})
