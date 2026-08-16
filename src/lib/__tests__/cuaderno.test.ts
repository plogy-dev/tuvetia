// El cuaderno guarda lo que el veterinario escribe DURANTE la consulta. Lo que se prueba acá es lo
// único que de verdad puede doler: que no se pierda lo tecleado, y que los dos cuadros de texto que
// lo pintan muestren lo mismo.
//
// El módulo no toca React —igual que `sesion.ts`— así que se ejercita directo, sin simular hooks.
// La versión anterior de este archivo tenía que falsear `useState`/`useEffect` enteros; con la
// lógica fuera de React eso desaparece.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
        eq: () => ({ maybeSingle: async () => ({ data: { notebook: notebookEnLaBase } }) }),
      }),
    }),
  }),
}))

const { cuaderno, _reiniciarCuaderno } = await import("@/lib/consulta-viva/cuaderno")

beforeEach(() => {
  guardados.length = 0
  fallaElGuardado = false
  notebookEnLaBase = null
  _reiniciarCuaderno()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe("una sola fuente de verdad", () => {
  it("los DOS cuadros del mismo cuaderno leen lo mismo, sin remontar", () => {
    // Es el defecto que motivó el refactor: la pantalla de la consulta y el panel flotante pintaban
    // el mismo cuaderno con dos `useState` distintos, así que escribir en uno no movía el otro.
    cuaderno.escribir("x1", "Peso 12,4")
    expect(cuaderno.leer("x1").texto).toBe("Peso 12,4")
  })

  it("avisa a los suscriptos en cada tecla", () => {
    const visto: string[] = []
    const desuscribir = cuaderno.suscribir(() => visto.push(cuaderno.leer("x1").texto))
    cuaderno.escribir("x1", "Pes")
    cuaderno.escribir("x1", "Peso")
    desuscribir()
    cuaderno.escribir("x1", "Peso 12")
    expect(visto).toEqual(["Pes", "Peso"]) // después de desuscribir no llega nada
  })

  it("cada consulta tiene su propio texto", () => {
    // La pantalla puede estar en la consulta A mientras se graba la B.
    cuaderno.escribir("x1", "lo de A")
    cuaderno.escribir("x2", "lo de B")
    expect(cuaderno.leer("x1").texto).toBe("lo de A")
    expect(cuaderno.leer("x2").texto).toBe("lo de B")
  })

  it("devuelve la MISMA referencia mientras nada cambie", () => {
    // `useSyncExternalStore` compara por referencia: si esto devolviera un objeto nuevo en cada
    // llamada, React entraría en bucle infinito.
    cuaderno.escribir("x1", "algo")
    expect(cuaderno.leer("x1")).toBe(cuaderno.leer("x1"))
    expect(cuaderno.leer(null)).toBe(cuaderno.leer("otra-sin-nada"))
  })
})

describe("no se pierde lo escrito", () => {
  it("guarda tras dejar de escribir, no en cada tecla", async () => {
    cuaderno.escribir("x1", "Pes")
    cuaderno.escribir("x1", "Peso ")
    cuaderno.escribir("x1", "Peso 12,4")
    expect(guardados).toHaveLength(0)

    await vi.advanceTimersByTimeAsync(1300)
    expect(guardados).toEqual([{ id: "x1", texto: "Peso 12,4" }])
    expect(cuaderno.leer("x1").estado).toBe("guardado")
  })

  it("AL MINIMIZAR guarda lo tecleado, aunque el rebote no haya vencido", async () => {
    // El panel se DESMONTA al minimizar. Sin vaciar en la limpieza se perdía lo escrito desde la
    // última pausa.
    cuaderno.escribir("x1", "Pedir hemograma")
    expect(guardados).toHaveLength(0)

    cuaderno.cancelarEspera("x1")
    await cuaderno.vaciar("x1")
    expect(guardados).toEqual([{ id: "x1", texto: "Pedir hemograma" }])
  })

  it("si el guardado falla, lo escrito NO se descarta: el siguiente lo reintenta", async () => {
    fallaElGuardado = true
    cuaderno.escribir("x1", "no se pierde")
    await vi.advanceTimersByTimeAsync(1300)
    expect(guardados).toHaveLength(0)
    expect(cuaderno.leer("x1").estado).toBe("error")

    fallaElGuardado = false
    await cuaderno.vaciar("x1")
    expect(guardados).toEqual([{ id: "x1", texto: "no se pierde" }])
  })

  it("sin consulta viva no escribe nada", async () => {
    cuaderno.escribir(null, "esto no va a ningún lado")
    await vi.advanceTimersByTimeAsync(2000)
    expect(guardados).toHaveLength(0)
  })

  it("no guarda de nuevo si nada cambió", async () => {
    cuaderno.escribir("x1", "una sola vez")
    await vi.advanceTimersByTimeAsync(1300)
    expect(guardados).toHaveLength(1)

    await cuaderno.vaciar("x1")
    expect(guardados).toHaveLength(1)
  })
})

describe("la lectura inicial", () => {
  it("trae lo guardado", async () => {
    notebookEnLaBase = "lo de la vez pasada"
    await cuaderno.cargar("x1")
    expect(cuaderno.leer("x1").texto).toBe("lo de la vez pasada")
  })

  it("NO pisa lo que el vet ya escribió", async () => {
    // Puede escribir y minimizar antes de que la lectura vuelva; sobrescribirlo sería borrarle lo
    // que acaba de teclear.
    notebookEnLaBase = "lo viejo"
    cuaderno.escribir("x1", "lo que acabo de escribir")
    await cuaderno.cargar("x1")
    expect(cuaderno.leer("x1").texto).toBe("lo que acabo de escribir")
  })

  it("se pide UNA sola vez aunque el cuaderno se monte en dos lugares", async () => {
    notebookEnLaBase = "algo"
    await cuaderno.cargar("x1")
    notebookEnLaBase = "otra cosa"
    await cuaderno.cargar("x1")
    expect(cuaderno.leer("x1").texto).toBe("algo")
  })
})
