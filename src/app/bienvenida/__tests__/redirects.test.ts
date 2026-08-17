// Las cuatro combinaciones de (clínica, setup) y a dónde va cada una.
//
// Existe por un lazo infinito que casi entra a producción: `dashboard/layout.tsx` manda a
// /bienvenida cuando falta la clínica, y esta página redirigía al dashboard si `setup_completed_at`
// estaba puesto. Un usuario SIN clínica y CON el flag —caso real, porque el backfill de la
// migración 0017 puso el flag a todos los perfiles, tuvieran clínica o no— rebotaría entre las dos
// rutas para siempre. El arreglo es de orden: se mira la clínica primero.
import { beforeEach, describe, expect, it, vi } from "vitest"

const getUser = vi.fn()
const perfil = vi.fn()
const clinica = vi.fn()
const rpc = vi.fn()

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    // Next aborta el render lanzando; se replica para poder afirmar sobre el destino.
    const e = new Error(`REDIRECT:${destino}`)
    ;(e as Error & { destino?: string }).destino = destino
    throw e
  },
}))

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    rpc,
    from: (tabla: string) => ({
      select: () => ({
        eq: () => ({ maybeSingle: tabla === "profiles" ? perfil : clinica }),
      }),
    }),
  }),
}))

// El progreso de configuración entró a esta página el 2026-08-16, para que el wizard no vuelva a
// pedir lo que la clínica ya tiene (repetir el onboarding duplicaba titular, paciente y servicios).
// Tiene sus propias consultas y sus propios tests; acá se mockea porque este archivo decide RUTEO, y
// emular la forma de seis consultas más sólo lo haría frágil sin comprobar nada nuevo.
vi.mock("@/lib/onboarding/consultar", () => ({
  progresoDeConfiguracion: async () => ({
    pasos: [],
    hechos: 0,
    total: 6,
    porcentaje: 0,
    completo: false,
    siguiente: null,
  }),
}))

// Los componentes cliente no se renderizan acá: sólo interesa la decisión de ruteo.
vi.mock("@/components/onboarding/welcome-wizard", () => ({ WelcomeWizard: () => null }))
vi.mock("@/components/onboarding/onboarding-athos", () => ({ OnboardingAthos: () => null }))
vi.mock("@/components/onboarding/sin-clinica", () => ({ SinClinica: () => null }))

import BienvenidaPage from "@/app/bienvenida/page"

/** Devuelve el destino del redirect, o "RENDER" si la página renderizó sin redirigir. */
async function destinoDe(): Promise<string> {
  try {
    await BienvenidaPage()
    return "RENDER"
  } catch (e) {
    const d = (e as Error & { destino?: string }).destino
    if (d) return d
    throw e
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getUser.mockResolvedValue({ data: { user: { id: "u1" } } })
  clinica.mockResolvedValue({ data: { name: "Vet San Martín", logo_url: null } })
  rpc.mockResolvedValue({ data: false })
})

describe("ruteo de /bienvenida", () => {
  it("sin sesión -> login", async () => {
    getUser.mockResolvedValue({ data: { user: null } })
    expect(await destinoDe()).toBe("/login")
  })

  it("con clínica y setup pendiente -> renderiza el wizard", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: "c1", setup_completed_at: null } })
    expect(await destinoDe()).toBe("RENDER")
  })

  it("con clínica y setup hecho -> dashboard", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: "c1", setup_completed_at: "2026-07-24T05:56:21Z" } })
    expect(await destinoDe()).toBe("/dashboard")
  })

  it("sin clínica y setup pendiente -> renderiza, no redirige", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: null, setup_completed_at: null } })
    expect(await destinoDe()).toBe("RENDER")
  })

  // EL caso del lazo. Si esto vuelve a devolver "/dashboard", el layout rebota para acá y el
  // navegador queda dando vueltas hasta que aborta.
  it("sin clínica pero con setup hecho (backfill de 0017) -> renderiza, NUNCA rebota al dashboard", async () => {
    perfil.mockResolvedValue({
      data: { clinic_id: null, setup_completed_at: "2026-07-24T05:56:21.996069Z" },
    })
    expect(await destinoDe()).toBe("RENDER")
  })

  it("sin clínica: consulta si hay invitación pendiente para explicar el caso correcto", async () => {
    perfil.mockResolvedValue({ data: { clinic_id: null, setup_completed_at: null } })
    await destinoDe()
    expect(rpc).toHaveBeenCalledWith("has_pending_invitation")
  })
})
