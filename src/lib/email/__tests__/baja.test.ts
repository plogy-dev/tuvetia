/**
 * La baja del correo.
 *
 * TRES COSAS SE CUIDAN ACÁ, y ninguna se ve mirando la pantalla:
 *
 * 1. QUE LA BAJA NO APAGUE LA COBRANZA. Darse de baja de "a Nala le toca la vacuna" no puede dar de
 *    baja de "tenés una factura vencida": eso es la relación contractual y tiene su propio régimen
 *    (Ley 2300). Si el filtro viviera en el transporte, la primera baja apagaría los recordatorios
 *    de pago de ese titular y nadie lo notaría hasta que faltara la plata.
 *
 * 2. QUE `Ana@X.com` Y `ana@x.com` SEAN LA MISMA CASILLA. El correo está en la clave primaria: sin
 *    normalizar entrarían como dos filas y el filtro dejaría pasar una — o sea, le seguiría
 *    llegando correo a quien pidió que no.
 *
 * 3. QUE ANTE LA DUDA NO SE MANDE. Si no se puede leer quién está de baja, seguir de largo es
 *    mandarle a todos "porque no pudimos comprobarlo".
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

const filas = vi.fn()

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ in: filas }),
      }),
    }),
  }),
}))

import { esTokenDeBaja, normalizarCorreo, sinLosDeBaja } from "@/lib/email/baja"

beforeEach(() => {
  vi.clearAllMocks()
  filas.mockResolvedValue({ data: [], error: null })
})

describe("normalizar el correo", () => {
  it("mayúsculas y espacios no hacen una casilla nueva", () => {
    expect(normalizarCorreo("  Ana@X.com ")).toBe("ana@x.com")
    expect(normalizarCorreo(null)).toBe("")
  })
})

describe("el token", () => {
  it("sólo un uuid pasa", () => {
    expect(esTokenDeBaja("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true)
    expect(esTokenDeBaja("../../etc/passwd")).toBe(false)
    expect(esTokenDeBaja("")).toBe(false)
    expect(esTokenDeBaja(null)).toBe(false)
  })
})

describe("sacar de la lista a quien se dio de baja", () => {
  it("excluye al que está, y deja al que no", async () => {
    filas.mockResolvedValue({ data: [{ email: "ana@x.com" }], error: null })

    const r = await sinLosDeBaja("c1", ["ana@x.com", "beto@x.com"])

    expect(r.permitidos).toEqual(["beto@x.com"])
    expect(r.excluidos).toEqual(["ana@x.com"])
  })

  it("LA MAYÚSCULA NO ES UNA CASILLA NUEVA", async () => {
    // Lo que la base guarda está normalizado; lo que llega de una lista pegada a mano, no.
    filas.mockResolvedValue({ data: [{ email: "ana@x.com" }], error: null })

    const r = await sinLosDeBaja("c1", ["  Ana@X.COM "])

    expect(r.permitidos).toEqual([])
    expect(r.excluidos).toEqual(["ana@x.com"])
  })

  it("la misma dirección repetida en la lista no se manda dos veces", async () => {
    const r = await sinLosDeBaja("c1", ["beto@x.com", "BETO@x.com", "beto@x.com"])
    expect(r.permitidos).toEqual(["beto@x.com"])
  })

  it("SI NO SE PUEDE COMPROBAR, NO SE MANDA NADA", async () => {
    // El fallo cerrado. Devolver la lista entera ante un error de lectura sería mandarle correo a
    // quien se dio de baja, que es el único fallo que esta función no puede tener.
    filas.mockResolvedValue({ data: null, error: { message: "se cayó" } })

    const r = await sinLosDeBaja("c1", ["ana@x.com", "beto@x.com"])

    expect(r.permitidos).toEqual([])
    expect(r.excluidos).toEqual(["ana@x.com", "beto@x.com"])
  })

  it("una lista vacía no consulta la base", async () => {
    const r = await sinLosDeBaja("c1", ["", "   "])
    expect(r.permitidos).toEqual([])
    expect(filas).not.toHaveBeenCalled()
  })
})

describe("los acuerdos entre archivos", () => {
  const leer = (rel: string) => readFileSync(join(process.cwd(), "src", ...rel.split("/")), "utf8")

  it("LA BAJA NO TOCA EL CORREO TRANSACCIONAL", () => {
    // El corazón del asunto. Si `transactional.ts` empezara a filtrar por bajas, un titular que se
    // dio de baja de los avisos dejaría de recibir sus facturas y sus recordatorios de pago — y eso
    // no se nota: se nota meses después, en la cartera.
    const transporte = leer("lib/email/transactional.ts") + leer("lib/cartera/channels.ts")
    expect(transporte).not.toMatch(/sinLosDeBaja|owner_email_optout|email\/baja/)
  })

  it("el GET no da de baja: la escritura vive en una server action", () => {
    // Los antivirus y filtros corporativos ABREN los enlaces de un correo antes de entregarlo. Con
    // la baja colgada del GET, media lista quedaría dada de baja sola.
    const pagina = leer("app/baja/[token]/page.tsx")
    const accion = leer("app/baja/[token]/actions.ts")

    expect(accion).toMatch(/^"use server"/)
    expect(accion).toMatch(/registrarBaja/)
    // La página pregunta y ofrece un formulario; no escribe por su cuenta al renderizar.
    expect(pagina).toMatch(/<form action=/)
    expect(pagina).not.toMatch(/registrarBaja\(/)
  })

  it("la página no filtra por índice ni expone de más", () => {
    const pagina = leer("app/baja/[token]/page.tsx")
    expect(pagina).toMatch(/robots:\s*\{\s*index:\s*false/)
    expect(pagina).toMatch(/notFound\(\)/)
  })
})
