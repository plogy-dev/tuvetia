import { describe, expect, it } from "vitest"

import { estadoDeAcceso } from "@/lib/acceso"

const perfil = (over: Partial<NonNullable<Parameters<typeof estadoDeAcceso>[0]>> = {}) => ({
  is_active: true,
  clinic_id: "c1",
  setup_completed_at: "2026-01-01T00:00:00Z",
  ...over,
})

describe("estadoDeAcceso", () => {
  it("el camino normal", () => {
    expect(estadoDeAcceso(perfil())).toBe("activo")
  })

  it("DESACTIVADA gana sobre sin-clínica, aunque la clínica venga en null", () => {
    // Es el caso que obliga a que el orden sea éste: con el gate de la 0059 la RLS deja de mostrarle
    // la clínica a un perfil inactivo, así que llega con `clinic_id` en null. Preguntando por la
    // clínica primero, la app le ofrecería CREAR UNA NUEVA — justo lo que la desactivación impide.
    expect(estadoDeAcceso(perfil({ is_active: false, clinic_id: null }))).toBe("desactivada")
  })

  it("desactivada también si conserva la clínica y el setup", () => {
    expect(estadoDeAcceso(perfil({ is_active: false }))).toBe("desactivada")
  })

  it("sin clínica: invitación sin aceptar o alta que no corrió", () => {
    expect(estadoDeAcceso(perfil({ clinic_id: null }))).toBe("sin-clinica")
  })

  it("sin-clínica gana sobre onboarding — es lo que evitaba el lazo de redirecciones", () => {
    // El backfill de la 0017 puso `setup_completed_at` a TODOS los perfiles, incluidos los que no
    // tenían clínica. Con el orden invertido, layout y bienvenida se redirigían para siempre.
    expect(estadoDeAcceso(perfil({ clinic_id: null, setup_completed_at: "2026-01-01T00:00:00Z" })))
      .toBe("sin-clinica")
  })

  it("con clínica y sin wizard terminado, va al onboarding", () => {
    expect(estadoDeAcceso(perfil({ setup_completed_at: null }))).toBe("onboarding")
  })

  it("un perfil que no se pudo leer se comporta como antes: al onboarding", () => {
    expect(estadoDeAcceso(null)).toBe("sin-clinica")
  })

  it("`is_active` ausente NO es una cuenta desactivada", () => {
    // Un select que no pidió la columna deja `undefined`, y eso no puede leerse como desactivada:
    // dejaría fuera a media plataforma por una consulta incompleta.
    const sinLaColumna = { clinic_id: "c1", setup_completed_at: "2026-01-01T00:00:00Z" }
    expect(estadoDeAcceso(sinLaColumna)).toBe("activo")
    expect(estadoDeAcceso({ ...sinLaColumna, is_active: null })).toBe("activo")
  })
})
