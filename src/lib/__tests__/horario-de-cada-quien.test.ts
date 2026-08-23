/**
 * El horario de cada quien: cuál manda, y quién sigue leyendo el de la clínica.
 *
 * DOS TESTS EN UNO, y a propósito.
 *
 * El primero prueba la REGLA (`franjasQueMandan`), que es pura y se prueba entera.
 *
 * El segundo lee el fuente, y es el que de verdad protege el cambio. La migración 0069 metió DOS
 * horarios en la misma tabla: el de la clínica (`vet_id` nulo) y el de cada persona. Todo lector
 * que existía antes fue escrito cuando había uno solo, así que si no se lo fija a `vet_id is null`
 * empieza a mezclar sin avisar: el modo auto de WhatsApp le contestaría a un titular que la clínica
 * abre a las 2 porque ESE VET entra a las 2, y el riel de configuración daría por hecho el paso de
 * la clínica porque alguien cargó su horario personal.
 *
 * Ninguno de esos dos fallos tira un error. Los dos dan una respuesta plausible y equivocada, que
 * es la clase de bug que no aparece en ninguna pantalla roja.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  franjasQueMandan,
  tieneHorarioPropio,
  type FranjaDeAlguien,
} from "@/lib/agenda/horario-de-cada-quien"

const YO = "11111111-1111-1111-1111-111111111111"
const OTRO = "22222222-2222-2222-2222-222222222222"

function franja(weekday: number, opens_at: string, vet_id: string | null): FranjaDeAlguien {
  return { weekday, opens_at, closes_at: "20:00", vet_id }
}

describe("de quién es el horario que manda", () => {
  it("sin horario propio, manda el de la clínica", () => {
    const filas = [franja(1, "08:00", null), franja(2, "08:00", null)]
    expect(franjasQueMandan(filas, YO)).toHaveLength(2)
    expect(franjasQueMandan(filas, YO).every((f) => f.vet_id === null)).toBe(true)
  })

  it("el día que definí es mío, y el resto de la semana sigue siendo de la clínica", () => {
    // ES LA DECISIÓN DE DISEÑO, y la que más fácil se rompe al refactorizar: si tener horario
    // propio apagara el de la clínica en bloque, cargar "los martes entro a las 2" dejaría a esta
    // persona sin horario de miércoles a lunes. Nadie lee eso en la UI antes de que un titular se
    // quede sin cupo.
    const filas = [
      franja(1, "08:00", null),
      franja(2, "08:00", null),
      franja(3, "08:00", null),
      franja(2, "14:00", YO),
    ]
    const manda = franjasQueMandan(filas, YO)
    expect(manda).toHaveLength(3)
    expect(manda.find((f) => f.weekday === 2)?.opens_at).toBe("14:00")
    expect(manda.find((f) => f.weekday === 1)?.vet_id).toBeNull()
    expect(manda.find((f) => f.weekday === 3)?.vet_id).toBeNull()
  })

  it("el horario de un compañero no se me aplica a mí", () => {
    const filas = [franja(2, "08:00", null), franja(2, "14:00", OTRO)]
    const manda = franjasQueMandan(filas, YO)
    expect(manda).toHaveLength(1)
    expect(manda[0].opens_at).toBe("08:00")
  })

  it("sin persona, manda el de la clínica — que es lo que se le responde a un titular", () => {
    const filas = [franja(2, "08:00", null), franja(2, "14:00", YO)]
    expect(franjasQueMandan(filas, null)).toEqual([franja(2, "08:00", null)])
  })

  it("un día propio tapa TODAS las franjas de la clínica de ese día", () => {
    // Una clínica partida en dos turnos (8–12 y 14–18) y alguien que definió uno solo: si el
    // reemplazo fuera franja por franja en vez de día por día, le quedaría su turno MÁS el de la
    // tarde de la clínica, o sea un horario que nunca escribió.
    const filas = [franja(2, "08:00", null), franja(2, "14:00", null), franja(2, "16:00", YO)]
    const manda = franjasQueMandan(filas, YO)
    expect(manda).toHaveLength(1)
    expect(manda[0].opens_at).toBe("16:00")
  })

  it("dice si esta persona tiene horario propio", () => {
    const filas = [franja(2, "08:00", null), franja(2, "14:00", YO)]
    expect(tieneHorarioPropio(filas, YO)).toBe(true)
    expect(tieneHorarioPropio(filas, OTRO)).toBe(false)
    expect(tieneHorarioPropio(filas, null)).toBe(false)
  })
})

// ── Lo que ningún test de unidad puede ver ──────────────────────────────────────────────────────

const RAIZ = join(process.cwd(), "src")

/** Quita comentarios: los de estos archivos citan `vet_id` y el escáner los leería como código. */
function leer(ruta: string): string {
  return readFileSync(join(RAIZ, ruta), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * Los lectores que hablan DE LA CLÍNICA y de nadie más, con por qué cada uno.
 *
 * Todos existían antes de la 0069, cuando `clinic_hours` tenía un solo dueño posible. Si alguno
 * pierde el filtro, empieza a mezclar el horario personal de quien sea con el de la puerta.
 */
const SOLO_DE_LA_CLINICA: { ruta: string; porque: string }[] = [
  {
    ruta: "lib/whatsapp/auto-reply.ts",
    porque: "al otro lado hay un titular preguntando a qué hora abre la clínica",
  },
  {
    ruta: "lib/athos-agent/auto-tools.ts",
    porque: "el titular no elige veterinario: los cupos que se le ofrecen son los de la clínica",
  },
  {
    ruta: "lib/onboarding/consultar.ts",
    porque: "el riel mide que la CLÍNICA cargó sus horarios, no que alguien cargó el suyo",
  },
]

describe("los lectores que hablan del horario de la clínica", () => {
  for (const { ruta, porque } of SOLO_DE_LA_CLINICA) {
    it(`${ruta} se queda con el de la clínica — ${porque}`, () => {
      const fuente = leer(ruta)
      // Que el archivo siga leyendo horarios (si dejó de hacerlo, este test no mide nada).
      expect(fuente).toContain("clinic_hours")
      expect(fuente).toMatch(/\.is\(\s*"vet_id",\s*null\s*\)/)
    })
  }

  it("los cupos de un veterinario salen de SU horario", () => {
    // ACOTADO A `list_available_slots` y no al archivo entero: `tools.ts` tiene otra herramienta
    // que también pide `vet_id.eq.`, así que buscar en todo el fuente daba por buena una versión
    // donde los cupos volvían a leer sólo el horario de la clínica. La primera versión de este
    // chequeo hacía exactamente eso y la mutación se lo demostró.
    const fuente = leer("lib/athos-agent/tools.ts")
    const desde = fuente.indexOf("list_available_slots:")
    expect(desde, "list_available_slots ya no existe").toBeGreaterThan(-1)
    const bloque = fuente.slice(desde, fuente.indexOf("tool({", fuente.indexOf("}),", desde)))
    expect(bloque).toContain("franjasQueMandan")
    expect(bloque).toMatch(/vet_id\.eq\./)
  })

  it("los huecos del día son los de quien mira la agenda", () => {
    const fuente = leer("app/dashboard/calendario/page.tsx")
    expect(fuente).toContain("franjasQueMandan")
    expect(fuente).toMatch(/vet_id\.eq\./)
  })

  it("el asistente de bienvenida carga horario de clínica, no personal", () => {
    // Es el que crea las primeras filas de una clínica nueva. Si nacieran con `vet_id` puesto, esa
    // clínica arrancaría sin horario de la puerta y nadie sabría por qué.
    //
    // SE MIRA LA FILA QUE SE INSERTA, no el archivo: la firma de la función declara `vet_id: null`
    // como TIPO, y un `vet_id: null` en la anotación no dice nada de lo que se guarda. La primera
    // versión de este chequeo se conformaba con eso y dejaba pasar `vet_id: clinicId`.
    const fuente = leer("lib/onboarding/horarios-sugeridos.ts")
    const fila = fuente.slice(fuente.indexOf("dias.filter(diaValido).map"))
    expect(fila).toMatch(/vet_id:\s*null,/)
  })
})
