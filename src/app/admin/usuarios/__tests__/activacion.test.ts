// El interruptor de acceso de una cuenta.
//
// POR QUÉ ESTE ARCHIVO. `cambiarActivacion` es lo único que escribe `profiles.is_active`, la columna
// que decide si alguien entra a la plataforma. Y es una SERVER ACTION, o sea un endpoint propio
// invocable con un POST: el `notFound()` del layout de /admin corre al renderizar la página y no la
// protege. Todo lo que la separa de "cualquiera desactiva a cualquiera" es el gate de adentro.
//
// Lo que se fija son invariantes: que sólo un admin de plataforma pueda tocarla, que nadie se
// desactive a sí mismo, y que cada cambio deje traza.

import { beforeEach, describe, expect, it, vi } from "vitest"

// ─── Dobles ──────────────────────────────────────────────────────────────────────────────────────

const getUser = vi.fn()

/** Todo lo que la acción escribió con el cliente admin, en orden. */
let escrituras: { tabla: string; op: "update" | "insert"; datos: Record<string, unknown> }[] = []
/** El perfil que devuelve la lectura previa. `null` = no existe. */
let perfil: { is_active: boolean | null; full_name: string | null } | null = null
/** Error a devolver en el UPDATE, para probar el camino de fallo. */
let errorUpdate: { message: string } | null = null

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: perfil, error: null }) }),
      }),
      update: (datos: Record<string, unknown>) => ({
        eq: async () => {
          escrituras.push({ tabla, op: "update", datos })
          return { error: errorUpdate }
        },
      }),
      insert: async (datos: Record<string, unknown>) => {
        escrituras.push({ tabla, op: "insert", datos })
        return { error: null }
      },
    }),
  }),
}))

// El correo de plataforma no se toca acá, pero el módulo lo importa.
vi.mock("@/lib/email/platform-sender", () => ({
  sendPlatformEmail: vi.fn(),
  platformEmailConfigurado: () => true,
}))

import { cambiarActivacion } from "@/app/admin/usuarios/actions"

const ADMIN = { id: "11111111-1111-4111-8111-111111111111", email: "admin@tuvetia.com" }
const OTRO = "22222222-2222-4222-8222-222222222222"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("PLATFORM_ADMIN_EMAILS", ADMIN.email)
  escrituras = []
  perfil = { is_active: true, full_name: "Dra. Ruiz" }
  errorUpdate = null
  getUser.mockResolvedValue({ data: { user: ADMIN } })
})

describe("quién puede tocar el interruptor", () => {
  // EL TEST QUE IMPORTA. Un veterinario cualquiera no está en PLATFORM_ADMIN_EMAILS, y esta acción
  // es alcanzable con un POST desde cualquier parte. Sin este gate, un usuario del producto podría
  // desactivar a cualquier otro — de su clínica o de otra.
  it("un usuario que NO es admin de plataforma no puede desactivar a nadie", async () => {
    getUser.mockResolvedValue({
      data: { user: { id: OTRO, email: "vet@otraclinica.com" } },
    })

    const res = await cambiarActivacion({ userId: ADMIN.id, activo: false })

    expect(res).toEqual({ ok: false, error: "No autorizado." })
    expect(escrituras).toHaveLength(0)
  })

  it("sin sesión tampoco", async () => {
    getUser.mockResolvedValue({ data: { user: null } })

    const res = await cambiarActivacion({ userId: OTRO, activo: false })

    expect(res.ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })

  // Con la allowlist vacía nadie es admin (`isPlatformAdmin` devuelve false sin la env). Que la
  // acción quede abierta si alguien despliega sin configurarla sería lo peor de los dos mundos.
  it("sin PLATFORM_ADMIN_EMAILS configurada, nadie es admin", async () => {
    vi.stubEnv("PLATFORM_ADMIN_EMAILS", "")

    const res = await cambiarActivacion({ userId: OTRO, activo: false })

    expect(res.ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })
})

describe("no desactivarse a sí mismo", () => {
  // El botón vive en una tabla donde el admin también aparece, en su propia fila. Esconder el botón
  // no alcanza: la acción es un endpoint y hay que comprobarlo del lado del servidor.
  it("rechaza desactivar la propia cuenta", async () => {
    const res = await cambiarActivacion({ userId: ADMIN.id, activo: false })

    expect(res).toEqual({ ok: false, error: "No podés desactivar tu propia cuenta." })
    expect(escrituras).toHaveLength(0)
  })

  // Reactivarse a sí mismo no deja a nadie afuera, así que no hay razón para bloquearlo.
  it("pero sí puede REactivar la propia cuenta", async () => {
    perfil = { is_active: false, full_name: "Yo" }

    const res = await cambiarActivacion({ userId: ADMIN.id, activo: true })

    expect(res.ok).toBe(true)
    expect(escrituras.some((e) => e.tabla === "profiles" && e.datos.is_active === true)).toBe(true)
  })
})

describe("el cambio y su traza", () => {
  it("desactivar escribe is_active=false y deja registro de quién y por qué", async () => {
    const res = await cambiarActivacion({ userId: OTRO, activo: false, motivo: "uso abusivo" })

    expect(res.ok).toBe(true)

    const update = escrituras.find((e) => e.op === "update")
    expect(update).toMatchObject({ tabla: "profiles", datos: { is_active: false } })

    const traza = escrituras.find((e) => e.op === "insert")
    expect(traza).toMatchObject({
      tabla: "audit_logs",
      datos: {
        action: "platform_user.deactivated",
        record_id: OTRO,
        user_id: ADMIN.id,
      },
    })
    expect(traza?.datos.payload).toMatchObject({ de: true, a: false, motivo: "uso abusivo" })
  })

  it("reactivar usa su propia acción en la traza, no la misma", async () => {
    perfil = { is_active: false, full_name: "Dra. Ruiz" }

    await cambiarActivacion({ userId: OTRO, activo: true })

    expect(escrituras.find((e) => e.op === "insert")?.datos.action).toBe("platform_user.reactivated")
  })

  // Que el mensaje lo diga es parte del producto: "desactivar" se lee como "borrar", y quien aprieta
  // el botón tiene que saber que es reversible.
  it("el mensaje aclara que los datos no se borraron", async () => {
    const res = await cambiarActivacion({ userId: OTRO, activo: false })

    expect(res.ok && res.mensaje).toMatch(/no se borraron/i)
  })

  it("si ya estaba en ese estado no escribe nada", async () => {
    perfil = { is_active: true, full_name: "Dra. Ruiz" }

    const res = await cambiarActivacion({ userId: OTRO, activo: true })

    expect(res.ok).toBe(true)
    expect(escrituras).toHaveLength(0)
  })

  it("un usuario inexistente no deja traza de un cambio que no pasó", async () => {
    perfil = null

    const res = await cambiarActivacion({ userId: OTRO, activo: false })

    expect(res).toEqual({ ok: false, error: "Ese usuario no existe." })
    expect(escrituras).toHaveLength(0)
  })

  // Si el UPDATE falla, no puede quedar una traza diciendo que se desactivó a alguien que sigue
  // entrando: el log de auditoría dejaría de ser evidencia.
  it("si el UPDATE falla no se registra la traza", async () => {
    errorUpdate = { message: "conexión perdida" }

    const res = await cambiarActivacion({ userId: OTRO, activo: false })

    expect(res.ok).toBe(false)
    expect(escrituras.some((e) => e.op === "insert")).toBe(false)
  })

  it("un id que no es un uuid se rechaza antes de tocar la base", async () => {
    const res = await cambiarActivacion({ userId: "no-soy-un-uuid", activo: false })

    expect(res.ok).toBe(false)
    expect(escrituras).toHaveLength(0)
  })
})
