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
}

describe("clinicaDeLaSesion", () => {
  it("una cuenta activa devuelve su clínica", async () => {
    const { cliente } = clienteQueDevuelve(PERFIL)

    const r = await clinicaDeLaSesion(cliente, "u-1")

    expect(r).toEqual({ ok: true, clinicId: "c-1", fullName: "Dra. Ruiz", role: "vet" })
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
  // a nadie — en silencio, y sin que ningún otro test lo note.
  it("pide is_active en el MISMO select, sin round-trip extra", async () => {
    const { cliente, select } = clienteQueDevuelve(PERFIL)

    await clinicaDeLaSesion(cliente, "u-1")

    expect(select).toHaveBeenCalledTimes(1)
    expect(select.mock.calls[0][0]).toContain("is_active")
  })

  // El mensaje lo lee un veterinario, no un desarrollador: no dice "is_active=false" ni "403".
  it("el mensaje no filtra detalle interno y dice a dónde escribir", async () => {
    expect(MENSAJE_DESACTIVADA).not.toMatch(/is_active|403|profiles/i)
    expect(MENSAJE_DESACTIVADA).toMatch(/soporte/i)
  })
})
