// Qué le llega al modelo sobre la pantalla que el vet tiene delante.
//
// POR QUÉ ESTE ARCHIVO. `derivarContexto` distingue ocho pantallas y el widget hasta las pinta
// ("Estás en la ficha de un paciente"), pero al agente sólo le llegaba el `patientId` — que es
// `null` en cinco de las ocho. Estos tests fijan qué se dice de cada una, y sobre todo qué NO se
// dice: nombrar una herramienta que no existe no vuelve al modelo más capaz, lo vuelve más
// propenso a inventar.
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { derivarContexto } from "@/lib/athos-context/derivar"
import { contextoParaElPrompt } from "@/lib/athos-context/para-el-prompt"

const UUID = "3f7b1c2e-9a4d-4e6f-8b1a-2c3d4e5f6a7b"
const OTRO = "11111111-2222-4333-8444-555555555555"

/** De la ruta al texto del prompt, que es el camino real. */
const desdeLaRuta = (path: string, sp?: string) =>
  contextoParaElPrompt(derivarContexto(path, sp ? new URLSearchParams(sp) : undefined))

describe("las pantallas que aportan contexto", () => {
  it("la ficha de un paciente nombra el id y la herramienta que lo lee", () => {
    const t = desdeLaRuta(`/dashboard/patients/${UUID}`)
    expect(t).toContain(UUID)
    expect(t).toContain("get_patient_summary")
  })

  // El caso que más se notaba: parado en una consulta, `patientId` llegaba null y Athos no sabía
  // siquiera de qué paciente se trataba.
  it("una consulta nombra su id y get_consultation_details", () => {
    const t = desdeLaRuta(`/dashboard/consultas/${UUID}`)
    expect(t).toContain(UUID)
    expect(t).toContain("get_consultation_details")
  })

  it("la agenda dice que 'sin fecha' significa hoy", () => {
    const t = desdeLaRuta("/dashboard/calendario")
    expect(t).toContain("list_appointments_on_day")
    expect(t).toMatch(/hoy/i)
  })

  // La única herramienta de titulares busca por TELÉFONO. Si el prompt no lo dice, el modelo pide
  // "el titular Juan" a una herramienta que no sabe buscar por nombre.
  it("los titulares advierten que sólo se busca por teléfono", () => {
    const t = desdeLaRuta("/dashboard/owners")
    expect(t).toContain("get_owner_by_phone")
    expect(t).toMatch(/tel[eé]fono/i)
  })

  it("la bandeja pide desambiguar antes de proponer un mensaje", () => {
    expect(desdeLaRuta("/dashboard/comunicaciones")).toMatch(/pregunta|de qu[eé] conversaci/i)
  })
})

describe("facturación: dice dónde está y admite que no puede leerla", () => {
  // LA REGLA QUE ORDENA EL MÓDULO. No existe ninguna herramienta de facturas. Insinuar que sí
  // terminaría en un saldo inventado, y esto es una pantalla de cobranza.
  it("NO nombra ninguna herramienta de facturas, porque no hay", () => {
    const t = desdeLaRuta(`/dashboard/facturacion/${UUID}`)
    expect(t).not.toMatch(/get_invoice|search_invoice|list_invoice/i)
  })

  it("le dice al modelo que pida los datos en vez de suponerlos", () => {
    const conId = desdeLaRuta(`/dashboard/facturacion/${UUID}`)
    expect(conId).toContain(UUID)
    expect(conId).toMatch(/ped[ií]|pedile/i)

    const sinId = desdeLaRuta("/dashboard/facturacion")
    expect(sinId).toMatch(/ped[ií]|pedile/i)
  })

  // `/dashboard/facturacion/catalogo` no es una factura. Sin la validación de uuid, "catalogo"
  // viajaría al modelo como si fuera un identificador.
  it("una subruta con nombre no se confunde con un id de factura", () => {
    const t = desdeLaRuta("/dashboard/facturacion/catalogo")
    expect(t).not.toContain("catalogo")
  })
})

describe("las pantallas que NO aportan nada", () => {
  // Una línea que diga "estás en la plataforma" se paga en tokens en cada turno y no cambia
  // ninguna respuesta.
  it("el chat a pantalla completa y la navegación general no agregan línea", () => {
    expect(desdeLaRuta("/dashboard/asistente")).toBeNull()
    expect(desdeLaRuta(`/dashboard/asistente`, `patient=${UUID}`)).toBeNull()
    expect(desdeLaRuta("/dashboard")).toBeNull()
    expect(desdeLaRuta("/otra/cosa")).toBeNull()
  })

  // El paciente del selector ya viaja aparte en `patientId`; repetirlo sería decir lo mismo dos
  // veces en el mismo prompt.
  it("en el asistente el paciente viaja por su propio canal, no por acá", () => {
    expect(desdeLaRuta(`/dashboard/asistente`, `patient=${OTRO}`)).toBeNull()
  })
})

describe("todas las pantallas están contempladas", () => {
  // Si mañana `derivarContexto` gana un noveno tipo, el `switch` no compila sin su caso — pero un
  // caso que devuelva `undefined` sí compilaría. Esto lo caza.
  it("ninguna ruta del dashboard devuelve undefined", () => {
    const rutas = [
      "/dashboard",
      "/dashboard/asistente",
      `/dashboard/patients/${UUID}`,
      "/dashboard/patients",
      `/dashboard/consultas/${UUID}`,
      "/dashboard/consultas",
      "/dashboard/owners",
      "/dashboard/calendario",
      "/dashboard/comunicaciones",
      "/dashboard/facturacion",
      `/dashboard/facturacion/${UUID}`,
      "/dashboard/tablero",
      "/dashboard/settings",
    ]
    for (const r of rutas) {
      expect(desdeLaRuta(r), r).not.toBeUndefined()
    }
  })
})

describe("el alta: el modelo sabe en qué paso está parado el vet", () => {
  /**
   * ── PEDIDO DE LUCIANO (27-ago): «que el Athos sepa también dónde estás parado» ────────────────
   *
   * El chat del alta YA recibía el paso, pero sólo para mover una tarjeta de texto fijo. Lo decía el
   * comentario de su propia prop: «Mueve la tarjeta contextual; el chat no lo usa». Al modelo le
   * llegaba `source: "onboarding"` y nada más.
   *
   * Es además el único contexto que NO sale de la ruta: `/bienvenida` es una sola URL con seis pasos
   * guardados en estado de React, así que `derivarContexto` no puede verlo y viaja por el canal
   * opcional.
   */
  it("nombra el paso y cuántos son", () => {
    const linea = contextoParaElPrompt({ tipo: "onboarding", paso: 1 })!
    expect(linea).toContain("Horarios")
    expect(linea).toContain("2 de 6")
  })

  it("los seis pasos dan una línea, y ninguna dice «la configuración»", () => {
    // El respaldo `?? "la configuración"` existe para un índice fuera de rango. Si apareciera con un
    // paso válido, sería que las dos listas se separaron.
    for (let paso = 0; paso < 6; paso++) {
      const linea = contextoParaElPrompt({ tipo: "onboarding", paso })
      expect(linea, `paso ${paso}`).toBeTruthy()
      expect(linea, `paso ${paso}`).not.toContain("paso «la configuración»")
    }
  })

  it("avisa que la clínica está vacía, que es lo que de verdad cambia la respuesta", () => {
    // Sin esto el modelo llama a una herramienta, le vuelve cero, y contesta que no encontró
    // información — la primera impresión del producto es un asistente que no sabe nada de una
    // clínica que todavía no existe.
    const linea = contextoParaElPrompt({ tipo: "onboarding", paso: 0 })!
    expect(linea.toLowerCase()).toContain("vac")
    expect(linea).toMatch(/no es un error|todavía no se cargaron/i)
  })

  it("un índice fuera de rango no rompe ni miente", () => {
    const linea = contextoParaElPrompt({ tipo: "onboarding", paso: 99 })
    expect(linea).toBeTruthy()
    expect(linea).toContain("la configuración")
  })
})

describe("los pasos del alta no se desincronizan del wizard", () => {
  // `para-el-prompt.ts` copia `PASOS` a mano porque el wizard es un componente de cliente con
  // estado, toasts y Supabase, y este módulo es puro a propósito. La copia es la decisión correcta;
  // que se separe en silencio, no. Son las MISMAS seis etiquetas que el vet ve en la barra de
  // progreso, así que si allá se reordena un paso, acá el modelo nombraría el equivocado.
  it("las seis etiquetas son idénticas y están en el mismo orden", () => {
    const wizard = readFileSync(
      join(process.cwd(), "src", "components", "onboarding", "welcome-wizard.tsx"),
      "utf8",
    )
    const m = /const PASOS = \[([^\]]+)\]/.exec(wizard)
    expect(m, "no se pudo leer PASOS del wizard").not.toBeNull()
    const delWizard = [...m![1].matchAll(/"([^"]+)"/g)].map((x) => x[1])

    const prompt = readFileSync(
      join(process.cwd(), "src", "lib", "athos-context", "para-el-prompt.ts"),
      "utf8",
    )
    const p = /const PASOS_DEL_ALTA = \[([\s\S]*?)\]/.exec(prompt)
    const delPrompt = [...p![1].matchAll(/"([^"]+)"/g)].map((x) => x[1])

    expect(delPrompt).toEqual(delWizard)
  })
})
