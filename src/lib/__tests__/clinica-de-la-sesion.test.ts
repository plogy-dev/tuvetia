// La guarda que las rutas de API no tenían.
//
// POR QUÉ IMPORTA. La desactivación de una cuenta se apoyaba en dos cosas: la RLS (que le niega los
// datos de la clínica) y el layout del dashboard (que la saca de la interfaz). Ninguna de las dos
// impide que una petición llegue a `/api/athos/agent` con un JWT todavía válido, saque el
// `clinic_id` de su propio perfil —permitido por `profiles_select`, y hace falta que lo esté— y
// **gaste una llamada al modelo** antes de tocar la base.
//
// Estos tests fijan que la cuenta desactivada se rechace ANTES de eso.

import { describe, expect, it, vi } from "vitest"

import { clinicaDeLaSesion, MENSAJE_DESACTIVADA } from "@/lib/api/clinica-de-la-sesion"

/** Doble del cliente: sólo tiene que devolver la fila de `profiles` que se le indique. */
function clienteQueDevuelve(fila: Record<string, unknown> | null) {
  const select = vi.fn()
  const cliente = {
    from: () => ({
      select: (cols: string) => {
        select(cols)
        return { eq: () => ({ maybeSingle: async () => ({ data: fila, error: null }) }) }
      },
    }),
  }
  return { cliente: cliente as never, select }
}

const PERFIL = {
  clinic_id: "c-1",
  full_name: "Dra. Ruiz",
  role: "vet",
  is_active: true,
  // El embed de la clínica: PostgREST lo devuelve como objeto en una relación a-uno.
  clinic: { plan: "pro" },
}

describe("clinicaDeLaSesion", () => {
  it("una cuenta activa devuelve su clínica", async () => {
    const { cliente } = clienteQueDevuelve(PERFIL)

    const r = await clinicaDeLaSesion(cliente, "u-1")

    expect(r).toEqual({
      ok: true,
      clinicId: "c-1",
      fullName: "Dra. Ruiz",
      role: "vet",
      plan: "pro",
    })
  })

  // EL TEST QUE JUSTIFICA EL ARCHIVO.
  it("una cuenta desactivada se rechaza con 403, aunque tenga clínica", async () => {
    const { cliente } = clienteQueDevuelve({ ...PERFIL, is_active: false })

    const r = await clinicaDeLaSesion(cliente, "u-1")

    expect(r).toEqual({ ok: false, status: 403, mensaje: MENSAJE_DESACTIVADA })
  })

  // El 403 tiene que ganarle al 400: si está desactivada, da igual si tiene clínica o no, y decirle
  // "no tenés clínica" a alguien a quien le quitaron el acceso lo manda a arreglar lo que no es.
  it("desactivada Y sin clínica responde desactivada, no 'sin clínica'", async () => {
    const { cliente } = clienteQueDevuelve({ ...PERFIL, clinic_id: null, is_active: false })

    const r = await clinicaDeLaSesion(cliente, "u-1")

    expect(r).toMatchObject({ ok: false, status: 403 })
  })

  it("sin clínica responde 400 y lo dice", async () => {
    const { cliente } = clienteQueDevuelve({ ...PERFIL, clinic_id: null })

    const r = await clinicaDeLaSesion(cliente, "u-1")

    expect(r).toEqual({ ok: false, status: 400, mensaje: "El usuario no tiene clínica" })
  })

  // `is_active` es `not null default true`, pero un null —de un perfil anterior a la columna, o de
  // una lectura parcial— no puede dejar a alguien afuera. Cerrar el paso por un valor ausente sería
  // peor que el hueco que esto tapa.
  it("is_active null cuenta como ACTIVA", async () => {
    const { cliente } = clienteQueDevuelve({ ...PERFIL, is_active: null })

    expect((await clinicaDeLaSesion(cliente, "u-1")).ok).toBe(true)
  })

  it("un perfil que no existe responde 400, no revienta", async () => {
    const { cliente } = clienteQueDevuelve(null)

    expect(await clinicaDeLaSesion(cliente, "u-1")).toMatchObject({ ok: false, status: 400 })
  })

  // Si `is_active` se cayera del select, la guarda quedaría siempre en `undefined` y no bloquearía
  // a nadie — en silencio, y sin que ningún otro test lo note. Con `plan` pasa lo mismo pero al
  // revés: si se cayera, `comoPlan(undefined)` da `free` y TODAS las clínicas perderían Athos.
  it("pide is_active y el plan en el MISMO select, sin round-trip extra", async () => {
    const { cliente, select } = clienteQueDevuelve(PERFIL)

    await clinicaDeLaSesion(cliente, "u-1")

    expect(select).toHaveBeenCalledTimes(1)
    expect(select.mock.calls[0][0]).toContain("is_active")
    expect(select.mock.calls[0][0]).toContain("clinics!profiles_clinic_id_fkey(plan)")
  })

  // EL TEST QUE HABRÍA EVITADO UNA CAÍDA EN PRODUCCIÓN.
  //
  // Hay DOS claves foráneas entre `profiles` y `clinics` (`profiles.clinic_id → clinics.id` y
  // `clinics.owner_id → profiles.id`), así que un `clinics(plan)` sin desambiguar hace que PostgREST
  // devuelva PGRST201 y **falle el select entero**. Verificado contra el REST real: sin el nombre
  // del FK, `Could not embed because more than one relationship was found`.
  //
  // El síntoma fue de los peores: las nueve rutas respondiendo «El usuario no tiene clínica» a gente
  // que sí la tenía. Este test no puede ejecutar PostgREST, pero sí puede exigir que el nombre del
  // FK esté escrito — que es lo único que hace falta para que no se caiga otra vez.
  it("DESAMBIGUA el embed por nombre de FK: sin eso, PostgREST falla el select entero", async () => {
    const { cliente, select } = clienteQueDevuelve(PERFIL)

    await clinicaDeLaSesion(cliente, "u-1")

    const cols = select.mock.calls[0][0] as string
    expect(cols).not.toMatch(/clinic:clinics\(/)
    expect(cols).toContain("!profiles_clinic_id_fkey")
  })

  // ── Un fallo de consulta NO es "no tenés clínica" ────────────────────────────────────────────
  //
  // Confundirlos fue lo que hizo que el defecto de arriba costara una tarde: el error de PostgREST
  // se descartaba, `data` volvía null, y el 400 de "sin clínica" mandaba a mirar el lugar
  // equivocado. Ahora se distinguen.
  it("un error de la consulta responde 500, no el 400 de 'sin clínica'", async () => {
    const cliente = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { code: "PGRST201", message: "Could not embed" },
            }),
          }),
        }),
      }),
    } as never

    const r = await clinicaDeLaSesion(cliente, "u-1")

    expect(r).toMatchObject({ ok: false, status: 500 })
    // Y el mensaje NO puede decir "no tenés clínica": es exactamente la mentira que se está tapando.
    expect((r as { mensaje: string }).mensaje).not.toMatch(/no tiene clínica/i)
  })

  // ── El plan ──────────────────────────────────────────────────────────────────────────────────

  it("devuelve el plan de la clínica", async () => {
    const { cliente } = clienteQueDevuelve({ ...PERFIL, clinic: { plan: "free" } })

    expect(await clinicaDeLaSesion(cliente, "u-1")).toMatchObject({ ok: true, plan: "free" })
  })

  // Si la RLS niega el embed —o la columna llega vacía— el resultado tiene que ser free, no pro.
  // Al revés, un fallo de lectura regalaría el producto y sería explotable a voluntad.
  it("sin el embed de la clínica, el plan cae a free", async () => {
    const { cliente } = clienteQueDevuelve({ ...PERFIL, clinic: null })

    expect(await clinicaDeLaSesion(cliente, "u-1")).toMatchObject({ ok: true, plan: "free" })
  })

  // El mensaje lo lee un veterinario, no un desarrollador: no dice "is_active=false" ni "403".
  it("el mensaje no filtra detalle interno y dice a dónde escribir", async () => {
    expect(MENSAJE_DESACTIVADA).not.toMatch(/is_active|403|profiles/i)
    expect(MENSAJE_DESACTIVADA).toMatch(/soporte/i)
  })
})
