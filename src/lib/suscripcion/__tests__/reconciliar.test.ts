// La red para cuando el webhook no llega.
//
// NO ES UN ESCENARIO IMAGINADO. El 2026-08-17, primera prueba real contra sandbox: Wompi aprobó el
// cobro en un segundo, el webhook nunca llegó, el cobro quedó `PENDIENTE` para siempre y la clínica
// se quedó pagando y sin su plan. Hubo que destrabarlo a mano. Estos tests fijan que eso se resuelva
// solo la próxima vez.

import { beforeEach, describe, expect, it, vi } from "vitest"

/** Cobros que devuelve la consulta de colgados. */
let colgados: Record<string, unknown>[] = []
/** Estado que Wompi reporta por id de transacción. */
let estadosEnWompi: Record<string, { status: string; status_message?: string | null }> = {}
/** Lo que se le pidió aplicar a `aplicarResultado`. */
let aplicados: { transaccionId: string; estadoWompi: string }[] = []
/** Filtros que recibió la consulta, para comprobar la ventana de gracia. */
let filtros: Record<string, unknown> = {}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const nodo: Record<string, unknown> = {
        select: () => nodo,
        eq: (col: string, val: unknown) => {
          filtros[`eq:${col}`] = val
          return nodo
        },
        lt: (col: string, val: unknown) => {
          filtros[`lt:${col}`] = val
          return nodo
        },
        order: () => nodo,
        limit: async () => ({ data: colgados, error: null }),
      }
      return nodo
    },
  }),
}))

vi.mock("@/lib/wompi/api", () => ({
  consultarTransaccion: async (id: string) => {
    const e = estadosEnWompi[id]
    if (!e) return { ok: false as const, mensaje: "no encontrada" }
    return { ok: true as const, data: { id, status: e.status, status_message: e.status_message ?? null } }
  },
}))

vi.mock("@/lib/suscripcion/motor", () => ({
  aplicarResultado: async (p: { transaccionId: string; estadoWompi: string }) => {
    aplicados.push({ transaccionId: p.transaccionId, estadoWompi: p.estadoWompi })
    return { aplicado: true }
  },
}))

import { reconciliarCobrosColgados } from "@/lib/suscripcion/reconciliar"

const AHORA = new Date("2026-08-17T23:00:00.000Z")

beforeEach(() => {
  colgados = []
  estadosEnWompi = {}
  aplicados = []
  filtros = {}
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

describe("reconciliarCobrosColgados", () => {
  // EL CASO QUE MOTIVA EL ARCHIVO.
  it("resuelve un cobro aprobado cuyo webhook nunca llegó", async () => {
    colgados = [
      { id: "c1", referencia: "tuvetia-x-2026-08-1", wompi_transaction_id: "tx-1", created_at: "2026-08-17T20:00:00Z" },
    ]
    estadosEnWompi["tx-1"] = { status: "APPROVED" }

    const r = await reconciliarCobrosColgados(AHORA)

    expect(aplicados).toEqual([{ transaccionId: "tx-1", estadoWompi: "APPROVED" }])
    expect(r.resueltos).toBe(1)
  })

  it("también aplica un rechazo, no sólo las aprobaciones", async () => {
    // Un rechazo perdido deja a la clínica con Pro sin haber pagado. El agujero va para los dos
    // lados: uno cuesta un cliente enojado, el otro cuesta plata.
    colgados = [
      { id: "c1", referencia: "r", wompi_transaction_id: "tx-1", created_at: "2026-08-17T20:00:00Z" },
    ]
    estadosEnWompi["tx-1"] = { status: "DECLINED", status_message: "Fondos insuficientes" }

    await reconciliarCobrosColgados(AHORA)

    expect(aplicados[0].estadoWompi).toBe("DECLINED")
  })

  it("NO toca lo que Wompi todavía reporta PENDING", async () => {
    // Es el caso normal de un cobro reciente: no se resolvió aún. Aplicarlo sería inventar.
    colgados = [
      { id: "c1", referencia: "r", wompi_transaction_id: "tx-1", created_at: "2026-08-17T20:00:00Z" },
    ]
    estadosEnWompi["tx-1"] = { status: "PENDING" }

    const r = await reconciliarCobrosColgados(AHORA)

    expect(aplicados).toEqual([])
    expect(r.siguenPendientes).toBe(1)
    expect(r.resueltos).toBe(0)
  })

  // EL LÍMITE HONESTO DE ESTA RED, FIJADO COMO TEST.
  it("un cobro SIN id de transacción se REPORTA, no se adivina", async () => {
    // Sin id no hay nada que preguntarle a Wompi. Darlo por fallido podría hacer que se cobre dos
    // veces algo ya cobrado; darlo por bueno regalaría el plan. Se escala a una persona.
    colgados = [
      { id: "c1", referencia: "tuvetia-x-2026-08-1", wompi_transaction_id: null, created_at: "2026-08-17T20:00:00Z" },
    ]

    const r = await reconciliarCobrosColgados(AHORA)

    expect(aplicados).toEqual([])
    expect(r.huerfanos).toHaveLength(1)
    expect(r.huerfanos[0].referencia).toBe("tuvetia-x-2026-08-1")
  })

  it("no se cae si Wompi no responde: lo deja para la próxima corrida", async () => {
    colgados = [
      { id: "c1", referencia: "r", wompi_transaction_id: "tx-desconocida", created_at: "2026-08-17T20:00:00Z" },
    ]

    const r = await reconciliarCobrosColgados(AHORA)

    expect(aplicados).toEqual([])
    expect(r.revisados).toBe(1)
    expect(r.resueltos).toBe(0)
  })

  // La ventana de gracia es lo que evita preguntarle a Wompi por cobros que se acaban de disparar y
  // todavía están resolviéndose — llamadas gastadas para recibir PENDING.
  it("sólo mira cobros PENDIENTES más viejos que la ventana de gracia", async () => {
    await reconciliarCobrosColgados(AHORA)

    expect(filtros["eq:estado"]).toBe("PENDIENTE")
    const corte = new Date(filtros["lt:created_at"] as string)
    const minutos = (AHORA.getTime() - corte.getTime()) / 60_000
    expect(minutos).toBeGreaterThanOrEqual(10)
    expect(minutos).toBeLessThanOrEqual(60)
  })

  it("varios cobros a la vez: resuelve los que puede y reporta el resto", async () => {
    colgados = [
      { id: "c1", referencia: "r1", wompi_transaction_id: "tx-1", created_at: "2026-08-17T20:00:00Z" },
      { id: "c2", referencia: "r2", wompi_transaction_id: null, created_at: "2026-08-17T20:00:00Z" },
      { id: "c3", referencia: "r3", wompi_transaction_id: "tx-3", created_at: "2026-08-17T20:00:00Z" },
    ]
    estadosEnWompi["tx-1"] = { status: "APPROVED" }
    estadosEnWompi["tx-3"] = { status: "PENDING" }

    const r = await reconciliarCobrosColgados(AHORA)

    expect(r.revisados).toBe(3)
    expect(r.resueltos).toBe(1)
    expect(r.siguenPendientes).toBe(1)
    expect(r.huerfanos).toHaveLength(1)
  })
})
