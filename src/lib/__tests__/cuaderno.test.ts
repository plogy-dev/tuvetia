// El cuaderno guarda lo que el veterinario escribe DURANTE la consulta. Lo que se prueba acá es lo
// único que de verdad puede doler: que no se pierda lo tecleado.
//
// Se ejercita el módulo a través de su hook con un React mínimo simulado, porque la lógica que
// importa —el rebote, el vaciado al desmontar y el reintento tras un fallo— vive en él y no en el
// componente. Montar React entero para eso sería probar el framework.
//
// SE APAGA `react-hooks/globals` EN ESTE ARCHIVO, y no por comodidad: `vi.mock("react")` reemplaza
// React entero por las cuatro funciones de abajo, así que acá no hay render ni componentes que esa
// regla pueda proteger — el contador de llamadas que marca como "efecto durante el render" ES el
// mecanismo del doble. En `cuaderno.ts`, que es el código de verdad, las reglas siguen puestas, y
// ahí sí encontraron un defecto real: un ref mutado durante el render.
/* eslint-disable react-hooks/globals */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── El doble de Supabase ────────────────────────────────────────────────────────────────────────
const guardados: { id: string; texto: string }[] = []
let fallaElGuardado = false
let notebookEnLaBase: string | null = null

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: (patch: { notebook: string }) => ({
        eq: async (_c: string, id: string) => {
          if (fallaElGuardado) return { error: { message: "sin red" } }
          guardados.push({ id, texto: patch.notebook })
          return { error: null }
        },
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { notebook: notebookEnLaBase } }),
        }),
      }),
    }),
  }),
}))

// ── Un React mínimo: sólo lo que el hook usa ────────────────────────────────────────────────────
//
// `useState` guarda por índice de llamada, `useRef` persiste entre renders, y `useEffect` corre su
// cuerpo una vez y expone su limpieza para poder "desmontar" a mano.
let estados: unknown[] = []
let refs: { current: unknown }[] = []
let limpiezas: (() => void)[] = []
let i = 0
let r = 0

vi.mock("react", () => ({
  useState: (inicial: unknown) => {
    const j = i++
    if (!(j in estados)) estados[j] = typeof inicial === "function" ? (inicial as () => unknown)() : inicial
    return [estados[j], (v: unknown) => { estados[j] = typeof v === "function" ? (v as (p: unknown) => unknown)(estados[j]) : v }]
  },
  useRef: (inicial: unknown) => {
    const j = r++
    if (!refs[j]) refs[j] = { current: inicial }
    return refs[j]
  },
  useEffect: (fn: () => void | (() => void)) => {
    const limpieza = fn()
    if (typeof limpieza === "function") limpiezas.push(limpieza)
  },
  useCallback: (fn: unknown) => fn,
}))

const { useCuaderno } = await import("@/lib/consulta-viva/cuaderno")

/**
 * Un "render" del hook. Devuelve su API y una forma de desmontarlo.
 *
 * El nombre empieza por `use` para la regla de hooks: esto ES una llamada a un hook, sólo que
 * contra el React simulado de arriba en vez de contra un componente montado.
 */
function useMontar(consultaId: string | null) {
  i = 0
  r = 0
  limpiezas = []
  const api = useCuaderno(consultaId)
  const propias = [...limpiezas]
  return { ...api, desmontar: () => propias.forEach((f) => f()) }
}

beforeEach(() => {
  guardados.length = 0
  fallaElGuardado = false
  notebookEnLaBase = null
  estados = []
  refs = []
  limpiezas = []
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe("el cuaderno no pierde lo escrito", () => {
  it("guarda tras dejar de escribir, no en cada tecla", async () => {
    const c = useMontar("x1")
    c.escribir("Pes")
    c.escribir("Peso ")
    c.escribir("Peso 12,4")
    expect(guardados).toHaveLength(0) // todavía no: sigue tecleando

    await vi.advanceTimersByTimeAsync(1300)
    expect(guardados).toEqual([{ id: "x1", texto: "Peso 12,4" }]) // UNA escritura, la última
  })

  it("AL MINIMIZAR guarda lo tecleado, aunque el rebote no haya vencido", async () => {
    // Es el caso que motivó todo esto: el panel se DESMONTA al minimizar, y sin vaciar en la
    // limpieza se perdía lo escrito desde el último guardado.
    const c = useMontar("x1")
    c.escribir("Pedir hemograma")
    expect(guardados).toHaveLength(0)

    c.desmontar()
    await vi.advanceTimersByTimeAsync(0)
    expect(guardados).toEqual([{ id: "x1", texto: "Pedir hemograma" }])
  })

  it("al CAMBIAR de consulta vacía la anterior, no la nueva", async () => {
    // Con la limpieza atada a `[]` el id ya era el de la consulta nueva cuando corría, y lo
    // pendiente de la anterior no se guardaba nunca.
    const a = useMontar("x1")
    a.escribir("lo de la primera")
    a.desmontar()
    await vi.advanceTimersByTimeAsync(0)
    expect(guardados).toEqual([{ id: "x1", texto: "lo de la primera" }])
  })

  it("si el guardado falla, lo escrito NO se descarta: el siguiente lo reintenta", async () => {
    fallaElGuardado = true
    const c = useMontar("x1")
    c.escribir("no se pierde")
    await vi.advanceTimersByTimeAsync(1300)
    expect(guardados).toHaveLength(0) // falló

    fallaElGuardado = false
    c.desmontar() // el vaciado del desmontaje encuentra lo que quedó pendiente
    await vi.advanceTimersByTimeAsync(0)
    expect(guardados).toEqual([{ id: "x1", texto: "no se pierde" }])
  })

  it("sin consulta viva no escribe nada en la base", async () => {
    const c = useMontar(null)
    c.escribir("esto no va a ningún lado")
    await vi.advanceTimersByTimeAsync(2000)
    c.desmontar()
    await vi.advanceTimersByTimeAsync(0)
    expect(guardados).toHaveLength(0)
  })

  it("no guarda de nuevo si nada cambió desde el último guardado", async () => {
    const c = useMontar("x1")
    c.escribir("una sola vez")
    await vi.advanceTimersByTimeAsync(1300)
    expect(guardados).toHaveLength(1)

    c.desmontar() // sin teclas nuevas, el desmontaje no tiene nada que vaciar
    await vi.advanceTimersByTimeAsync(0)
    expect(guardados).toHaveLength(1)
  })
})
