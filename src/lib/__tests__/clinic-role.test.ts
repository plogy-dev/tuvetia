import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * El único gate de rol de la capa de aplicación. Guarda las tres acciones que salen de la clínica y
 * no tienen vuelta atrás: disparar la cobranza a mano, encender el modo automático de WhatsApp, y
 * reescribir la identidad fiscal con la que se emiten documentos ante la DIAN.
 *
 * Se fija el contrato entero porque es un gate de seguridad: sin sesión, sin clínica, rol equivocado
 * y —el que se olvida siempre— error de la consulta.
 */
let usuario: { id: string } | null = null
let perfil: { clinic_id: string | null; role: string | null } | null = null
let errorConsulta: { message: string } | null = null
const consultas: { tabla: string; columnas: string; filtros: Record<string, unknown> }[] = []

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: usuario } }) },
    from(tabla: string) {
      const filtros: Record<string, unknown> = {}
      let columnas = ""
      const q = {
        select(cols: string) {
          columnas = cols
          return q
        },
        eq(col: string, val: unknown) {
          filtros[col] = val
          return q
        },
        async maybeSingle() {
          consultas.push({ tabla, columnas, filtros })
          return { data: errorConsulta ? null : perfil, error: errorConsulta }
        },
      }
      return q
    },
  }),
}))

const { requireClinicAdmin, esAdminDeClinica } = await import("../clinic-role")

beforeEach(() => {
  usuario = null
  perfil = null
  errorConsulta = null
  consultas.length = 0
})

describe("requireClinicAdmin", () => {
  it("sin sesión no pasa", async () => {
    await expect(requireClinicAdmin()).rejects.toThrow(/No autenticado/)
  })

  it("con sesión pero sin clínica no pasa", async () => {
    usuario = { id: "u1" }
    perfil = { clinic_id: null, role: "admin" }
    await expect(requireClinicAdmin()).rejects.toThrow(/no tiene clínica/)
  })

  it("un vet no pasa, y se lo dice", async () => {
    usuario = { id: "u1" }
    perfil = { clinic_id: "c1", role: "vet" }
    await expect(requireClinicAdmin()).rejects.toThrow(/administrador/i)
  })

  it("un rol desconocido tampoco pasa", async () => {
    // Falla CERRADO: si mañana aparece un rol nuevo, no hereda permisos de admin por descuido.
    usuario = { id: "u1" }
    perfil = { clinic_id: "c1", role: "recepcion" }
    await expect(requireClinicAdmin()).rejects.toThrow(/administrador/i)
  })

  it("sin rol tampoco", async () => {
    usuario = { id: "u1" }
    perfil = { clinic_id: "c1", role: null }
    await expect(requireClinicAdmin()).rejects.toThrow(/administrador/i)
  })

  it("un admin pasa y devuelve su clínica", async () => {
    usuario = { id: "u1" }
    perfil = { clinic_id: "c1", role: "admin" }
    await expect(requireClinicAdmin()).resolves.toMatchObject({ clinicId: "c1", userId: "u1" })
  })

  it("un fallo de la consulta se distingue de 'no tenés clínica'", async () => {
    // Sin leer `error`, un problema de red daría `perfil = null` y el mensaje mandaría a buscar el
    // problema al lado equivocado. Es el mismo patrón que ya mordió tres veces esta semana.
    usuario = { id: "u1" }
    errorConsulta = { message: "fetch failed" }
    await expect(requireClinicAdmin()).rejects.toThrow(/verificar tu rol.*fetch failed/)
  })

  it("el perfil se busca por el id del usuario AUTENTICADO, y se pide el rol", async () => {
    usuario = { id: "u1" }
    perfil = { clinic_id: "c1", role: "admin" }
    await requireClinicAdmin()
    expect(consultas).toHaveLength(1)
    expect(consultas[0].tabla).toBe("profiles")
    expect(consultas[0].filtros.id).toBe("u1")
    // Las ocho copias de `requireClinic` piden sólo `clinic_id`; ésta tiene que pedir el rol o el
    // gate no gatea nada.
    expect(consultas[0].columnas).toMatch(/role/)
  })
})

describe("esAdminDeClinica", () => {
  it("es true para admin y false para todo lo demás", async () => {
    usuario = { id: "u1" }
    perfil = { clinic_id: "c1", role: "admin" }
    await expect(esAdminDeClinica()).resolves.toBe(true)
    perfil = { clinic_id: "c1", role: "vet" }
    await expect(esAdminDeClinica()).resolves.toBe(false)
    usuario = null
    await expect(esAdminDeClinica()).resolves.toBe(false)
  })
})
