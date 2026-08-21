// De quién son las citas que se ven en la agenda.
//
// LO QUE ESTOS TESTS PROTEGEN es que no desaparezca una cita. Un filtro de agenda que esconde de
// más no falla ruidosamente: la pantalla se ve prolija y el vet simplemente no va.

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  citasVisibles,
  deOtros,
  filtroDeConsulta,
  puedeVerLaAgendaCompleta,
  sinAsignar,
} from "@/lib/agenda/filtro"

const YO = "yo-uuid"
const OTRO = "otro-uuid"

const CITAS = [
  { id: "a", vet_id: YO },
  { id: "b", vet_id: OTRO },
  { id: "c", vet_id: null },
  { id: "d", vet_id: YO },
]

const ids = (cs: { id: string }[]) => cs.map((c) => c.id)

describe("el interruptor", () => {
  it("la clínica entera muestra todo", () => {
    expect(ids(citasVisibles(CITAS, "clinica", YO))).toEqual(["a", "b", "c", "d"])
  })

  it("mi agenda esconde las de otros", () => {
    expect(ids(citasVisibles(CITAS, "mia", YO))).not.toContain("b")
  })

  // LA DECISIÓN QUE NO ES OBVIA. Escondida, una cita sin asignar no aparece en la vista por defecto
  // de NADIE — y una cita que nadie mira es una cita a la que no va nadie.
  it("mi agenda SÍ muestra las que no son de nadie", () => {
    expect(ids(citasVisibles(CITAS, "mia", YO))).toEqual(["a", "c", "d"])
  })

  // Una agenda vacía se lee como "no tengo nada hoy", que es lo más caro que puede mentir esta
  // pantalla. Ante un dato que no llegó, mostrar de más.
  it("sin saber quién soy, no se esconde nada", () => {
    expect(ids(citasVisibles(CITAS, "mia", null))).toEqual(["a", "b", "c", "d"])
    expect(ids(citasVisibles(CITAS, "mia", undefined))).toEqual(["a", "b", "c", "d"])
  })

  it("no muta la lista original", () => {
    const copia = [...CITAS]
    citasVisibles(CITAS, "clinica", YO).pop()
    expect(CITAS).toEqual(copia)
  })

  it("una agenda vacía no rompe", () => {
    expect(citasVisibles([], "mia", YO)).toEqual([])
  })
})

describe("lo que hay que poder decir", () => {
  it("cuántas están sin asignar", () => {
    expect(sinAsignar(CITAS)).toBe(1)
    expect(sinAsignar([])).toBe(0)
  })

  // Es lo que el interruptor está escondiendo: decirlo es la diferencia entre filtrar y ocultar.
  it("cuántas son de otras personas", () => {
    expect(deOtros(CITAS, YO)).toBe(1)
  })

  it("sin saber quién soy, no hay 'otros'", () => {
    expect(deOtros(CITAS, null)).toBe(0)
  })
})

// ── El permiso de ver la agenda de toda la clínica (0070) ───────────────────────────────────────

describe("quién puede ver la agenda de toda la clínica", () => {
  it("un admin puede, sin que nadie se lo otorgue", () => {
    // SI HUBIERA QUE OTORGÁRSELO TAMBIÉN A ÉL, la primera persona de una clínica nueva —que es
    // admin por haberla creado— se quedaría sin ver la agenda de nadie y sin nadie que pudiera
    // dárselo. Un permiso del que no se puede salir es un permiso mal puesto.
    expect(puedeVerLaAgendaCompleta({ role: "admin" })).toBe(true)
    expect(puedeVerLaAgendaCompleta({ role: "admin", ve_agenda_completa: false })).toBe(true)
  })

  it("un vet no puede hasta que se lo den", () => {
    expect(puedeVerLaAgendaCompleta({ role: "vet" })).toBe(false)
    expect(puedeVerLaAgendaCompleta({ role: "vet", ve_agenda_completa: false })).toBe(false)
    expect(puedeVerLaAgendaCompleta({ role: "vet", ve_agenda_completa: true })).toBe(true)
  })

  it("sin perfil no puede — no se falla hacia el lado abierto", () => {
    expect(puedeVerLaAgendaCompleta(null)).toBe(false)
    expect(puedeVerLaAgendaCompleta(undefined)).toBe(false)
    expect(puedeVerLaAgendaCompleta({ role: null })).toBe(false)
  })
})

describe("con qué filtro se piden las citas", () => {
  it("quien puede ver todo pide todo", () => {
    expect(filtroDeConsulta({ role: "admin" }, "yo")).toBeNull()
    expect(filtroDeConsulta({ role: "vet", ve_agenda_completa: true }, "yo")).toBeNull()
  })

  it("quien no puede pide las suyas y las de nadie", () => {
    // LAS SIN ASIGNAR VIAJAN A PROPÓSITO. Esconderlas las dejaría fuera de la vista por defecto de
    // TODAS las personas de la clínica, y una cita que nadie mira es una cita a la que no va nadie.
    expect(filtroDeConsulta({ role: "vet" }, "yo")).toBe("vet_id.eq.yo,vet_id.is.null")
  })

  it("sin saber quién soy no se acota nada", () => {
    // Acotar por un id que no existe devolvería CERO citas, y una agenda vacía se lee como "no
    // tengo nada hoy" — la mentira más cara que puede decir esta pantalla.
    expect(filtroDeConsulta({ role: "vet" }, null)).toBeNull()
  })
})

// ── Que el permiso se aplique donde se piden los datos, no sólo donde se pintan ─────────────────

describe("dónde se aplica el permiso", () => {
  const leer = (ruta: string) =>
    readFileSync(join(process.cwd(), "src", ruta), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1")

  it("la consulta del servidor se acota", () => {
    // ANTES ESTO NO EXISTÍA: la pantalla se traía las citas de la clínica entera y el interruptor
    // las tapaba en el navegador. O sea que las citas de los demás viajaban igual en la página.
    const pagina = leer("app/dashboard/calendario/page.tsx")
    expect(pagina).toContain("filtroDeConsulta")
    expect(pagina).toMatch(/\.or\(acotarA\)/)
  })

  it("la consulta del cliente también", () => {
    // Es la mitad que se olvida: el calendario vuelve a pedir citas cada vez que se cambia de
    // semana. Aplicar el permiso sólo en la carga inicial no serviría de nada — bastaría avanzar
    // una semana para volver a traerse la agenda de todos.
    const calendario = leer("components/calendar/appointment-calendar.tsx")
    expect(calendario).toMatch(/\.or\(acotarA\)/)
    // Y el refetch tiene que depender del filtro, o React se queda con el de antes.
    expect(calendario).toMatch(/\[supabase, acotarA\]/)
  })

  it("el interruptor sólo aparece para quien puede", () => {
    // Un interruptor que no cambia nada es peor que ninguno: parecería que la clínica no tiene más
    // citas que las tuyas.
    expect(leer("components/calendar/appointment-calendar.tsx")).toMatch(/\{veTodo && miId && \(/)
  })

  it("el permiso se otorga por RPC, no por un update directo", () => {
    // Un trigger en `profiles` bloquea esta columna desde el cliente (0070). Sin la RPC, cualquiera
    // podría dárselo a sí mismo desde la consola del navegador: la policy de `profiles` deja que
    // cada uno edite su propio perfil.
    const equipo = leer("components/settings/team-settings.tsx")
    expect(equipo).toContain("otorgar_agenda_completa")
    expect(equipo).not.toMatch(/from\("profiles"\)[\s\S]{0,80}\.update\(/)
  })
})
