// El barrido: qué hace con cada clínica que ya venció.
//
// SE ESCRIBIÓ CON LA PRUEBA DE TRES DÍAS (0078) y cubre las dos mitades que ésta toca. La primera
// es obvia: que la prueba se termine. La segunda no lo es tanto — que el barrido NO le intente
// cobrar. Una prueba no tiene tarjeta, así que `cobrarPeriodo` devolvería un fallo, el fallo se
// cuenta como "omitida", y la clínica se quedaría en Pro para siempre mientras el informe dice que
// no se le pudo cobrar. Se vería como un problema de pagos y sería una prueba que no caduca.
//
// El resto de las ramas —cobrar, reintentar, bajar una cancelada— venían sin test y quedan cubiertas
// de paso: son las que este cambio podía romper al tocar el filtro de la consulta.

import { beforeEach, describe, expect, it, vi } from "vitest"

/** Filas que devuelve la consulta del barrido. */
let clinicas: Record<string, unknown>[] = []
/** Lo que se escribió en `clinics`, por id. */
let updates: { id: string; datos: Record<string, unknown> }[] = []
/** Filtros que recibió la consulta, para poder afirmar a QUIÉN mira. */
let filtros: Record<string, unknown> = {}
/** A quién se le intentó cobrar. Tiene que quedar vacío para una prueba. */
let cobros: { clinicId: string; motivo: string }[] = []

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      let pendiente: Record<string, unknown> | null = null
      const nodo: Record<string, unknown> = {
        select: () => nodo,
        lte: (col: string, val: unknown) => {
          filtros[`lte:${col}`] = val
          return nodo
        },
        in: (col: string, val: unknown) => {
          filtros[`in:${col}`] = val
          return nodo
        },
        order: () => nodo,
        limit: async () => ({ data: clinicas, error: null }),
        update: (datos: Record<string, unknown>) => {
          pendiente = datos
          return nodo
        },
        eq: async (_col: string, id: string) => {
          updates.push({ id, datos: pendiente ?? {} })
          return { error: null }
        },
      }
      return nodo
    },
  }),
}))

vi.mock("@/lib/suscripcion/motor", () => ({
  cobrarPeriodo: async ({ clinica, motivo }: { clinica: { id: string }; motivo: string }) => {
    cobros.push({ clinicId: clinica.id, motivo })
    return { ok: true as const }
  },
}))

const { barrerSuscripciones } = await import("../barrido")

const AHORA = new Date("2026-08-24T12:00:00.000Z")
const VENCIDA = "2026-08-24T09:00:00.000Z"

beforeEach(() => {
  clinicas = []
  updates = []
  filtros = {}
  cobros = []
})

describe("la prueba de tres días se termina sola", () => {
  it("una prueba vencida BAJA a free, y no se le intenta cobrar", async () => {
    clinicas = [
      {
        id: "c-prueba",
        plan: "pro",
        subscription_status: "trial",
        plan_renueva_en: VENCIDA,
        plan_cancelado_en: null,
        // Lo que define el caso: nunca puso una tarjeta.
        wompi_payment_source_id: null,
        wompi_customer_email: null,
      },
    ]

    const r = await barrerSuscripciones(AHORA)

    expect(r.bajadas).toBe(1)
    expect(updates).toHaveLength(1)
    expect(updates[0].id).toBe("c-prueba")
    expect(updates[0].datos.plan).toBe("free")
    expect(updates[0].datos.subscription_status).toBe("inactive")
    // El reloj se apaga: si quedara la fecha, el barrido la volvería a levantar todos los días.
    expect(updates[0].datos.plan_renueva_en).toBeNull()

    // LO QUE MÁS IMPORTA: ni un intento de cobro. Un cobro fallido la dejaría en Pro y contada como
    // "omitida", o sea una prueba que no caduca disfrazada de problema de pagos.
    expect(cobros).toEqual([])
    expect(r.omitidas).toEqual([])
  })

  it("el barrido MIRA a las clínicas en prueba: sin eso no vencen nunca", async () => {
    await barrerSuscripciones(AHORA)
    // Era el filtro de la consulta lo único que las dejaba afuera — el `plan_renueva_en` ya las
    // incluía desde siempre.
    expect(filtros["in:subscription_status"]).toContain("trial")
    expect(filtros["lte:plan_renueva_en"]).toBe(AHORA.toISOString())
  })
})

describe("las otras ramas siguen como estaban", () => {
  it("una cancelada baja a free", async () => {
    clinicas = [
      {
        id: "c-cancelada",
        plan: "pro",
        subscription_status: "canceled",
        plan_renueva_en: VENCIDA,
        plan_cancelado_en: "2026-08-10T00:00:00.000Z",
        wompi_payment_source_id: "src_1",
        wompi_customer_email: "a@b.co",
      },
    ]
    const r = await barrerSuscripciones(AHORA)
    expect(r.bajadas).toBe(1)
    expect(updates[0].datos.plan).toBe("free")
    expect(cobros).toEqual([])
  })

  it("una activa se cobra, y una en mora se reintenta", async () => {
    clinicas = [
      {
        id: "c-activa",
        plan: "pro",
        subscription_status: "active",
        plan_renueva_en: VENCIDA,
        plan_cancelado_en: null,
        wompi_payment_source_id: "src_1",
        wompi_customer_email: "a@b.co",
      },
      {
        id: "c-mora",
        plan: "pro",
        subscription_status: "past_due",
        plan_renueva_en: VENCIDA,
        plan_cancelado_en: null,
        wompi_payment_source_id: "src_2",
        wompi_customer_email: "c@d.co",
      },
    ]
    const r = await barrerSuscripciones(AHORA)
    expect(r.cobradas).toBe(2)
    expect(r.bajadas).toBe(0)
    expect(cobros).toEqual([
      { clinicId: "c-activa", motivo: "renovacion" },
      { clinicId: "c-mora", motivo: "reintento" },
    ])
    // Bajar no es lo mismo que cobrar: ninguna de estas dos se toca por fuera del motor.
    expect(updates).toEqual([])
  })
})

// ── Lo que encontró el review del 23-ago ───────────────────────────────────────────────────────
describe('a quién NO se le baja el plan', () => {
  // `trial` es además el DEFAULT HISTÓRICO de la columna: hay clínicas en `free` que lo llevan sin
  // haber probado nada. Mirando sólo el estado, cualquiera de ellas con un `plan_renueva_en`
  // vencido —una edición manual, un restore— se contaría como una prueba que terminó. `enPrueba()`
  // en `lib/planes` ya exigía las dos cosas; el barrido no.
  it('una clínica FREE con estado trial no es una prueba: no se toca', async () => {
    clinicas = [
      {
        id: 'c-legacy',
        plan: 'free',
        subscription_status: 'trial',
        plan_renueva_en: VENCIDA,
        plan_cancelado_en: null,
        wompi_payment_source_id: null,
        wompi_customer_email: null,
      },
    ]
    const r = await barrerSuscripciones(AHORA)
    expect(updates, 'no se le puede bajar el plan a quien nunca estuvo en prueba').toEqual([])
    expect(r.bajadas).toBe(0)
  })

  // `/api/suscripcion/suscribir` guarda la fuente de pago y cobra, pero NO escribe
  // `subscription_status`: eso lo hace el webhook de Wompi, que es asíncrono y normalmente vuelve
  // PENDING. Una clínica que contrata el último día de prueba sigue en `trial` hasta que llegue, y
  // el barrido de ese día le quitaba Athos a mitad de jornada y le borraba el reloj del reintento.
  it('una prueba vencida que YA cargó medio de pago espera al webhook', async () => {
    clinicas = [
      {
        id: 'c-pago-en-vuelo',
        plan: 'pro',
        subscription_status: 'trial',
        plan_renueva_en: VENCIDA,
        plan_cancelado_en: null,
        wompi_payment_source_id: 'src_recien_cargada',
        wompi_customer_email: 'vet@clinica.co',
      },
    ]
    const r = await barrerSuscripciones(AHORA)
    expect(updates, 'pagó: no se le baja el plan mientras el webhook está en vuelo').toEqual([])
    expect(r.bajadas).toBe(0)
    expect(cobros, 'tampoco se le vuelve a cobrar').toEqual([])
    // Queda dicho por qué no se tocó, que es lo que hace diagnosticable una corrida.
    expect(r.omitidas[0]?.motivo).toMatch(/webhook/i)
  })
})
