import { describe, expect, it } from "vitest"

import {
  derivarContexto,
  describirContexto,
  pacienteDelContexto,
} from "../athos-context/derivar"

const UUID_A = "3f2504e0-4f89-41d3-9a0c-0305e82c3301"
const UUID_B = "6ba7b810-9dad-11d1-80b4-00c04fd430c8"

const ctx = (ruta: string, qs?: string) =>
  derivarContexto(ruta, qs ? new URLSearchParams(qs) : undefined)

describe("derivarContexto", () => {
  it("la ficha de un paciente", () => {
    expect(ctx(`/dashboard/patients/${UUID_A}`)).toEqual({ tipo: "paciente", patientId: UUID_A })
  })

  it("el LISTADO de pacientes no es un paciente", () => {
    // Sin esto, "patients" no existiría como id pero tampoco habría contexto correcto.
    expect(ctx("/dashboard/patients")).toEqual({ tipo: "general" })
  })

  it("una consulta trae su id, NO el del paciente", () => {
    // La ruta no dice quién es el paciente; resolverlo cuesta una query y la hace el widget al
    // abrirse. Que este contrato quede fijado importa: es lo que evita una query por navegación.
    const c = ctx(`/dashboard/consultas/${UUID_A}`)
    expect(c).toEqual({ tipo: "consulta", consultaId: UUID_A })
    expect(pacienteDelContexto(c)).toBeNull()
  })

  it("el asistente lee el paciente del query string", () => {
    expect(ctx("/dashboard/asistente", `patient=${UUID_B}`)).toEqual({
      tipo: "asistente",
      patientId: UUID_B,
    })
  })

  it("el asistente sin paciente es consulta general, no un error", () => {
    expect(ctx("/dashboard/asistente")).toEqual({ tipo: "asistente", patientId: null })
  })

  it("un ?patient= basura se descarta en vez de viajar al agente", () => {
    expect(ctx("/dashboard/asistente", "patient=' OR 1=1--")).toEqual({
      tipo: "asistente",
      patientId: null,
    })
  })

  it("una factura sí, pero sus pantallas hermanas no", () => {
    // Éste es el caso que obliga a validar la forma del uuid: hay varias subrutas con nombre.
    expect(ctx(`/dashboard/facturacion/${UUID_A}`)).toEqual({
      tipo: "facturacion",
      facturaId: UUID_A,
    })
    for (const ruta of [
      "/dashboard/facturacion",
      "/dashboard/facturacion/nueva",
      "/dashboard/facturacion/catalogo",
      `/dashboard/facturacion/compras/${UUID_A}`,
    ]) {
      expect(ctx(ruta)).toEqual({ tipo: "facturacion", facturaId: null })
    }
  })

  it("las secciones sin entidad", () => {
    expect(ctx("/dashboard/owners")).toEqual({ tipo: "titulares" })
    expect(ctx("/dashboard/calendario")).toEqual({ tipo: "agenda" })
    expect(ctx("/dashboard/comunicaciones")).toEqual({ tipo: "comunicaciones" })
  })

  it("lo que no conocemos cae en general y no rompe", () => {
    for (const ruta of [
      "/dashboard",
      "/dashboard/settings",
      "/dashboard/conexiones",
      "/dashboard/ayuda",
      "/dashboard/algo-que-todavia-no-existe",
    ]) {
      expect(ctx(ruta)).toEqual({ tipo: "general" })
    }
  })

  it("fuera del dashboard no hay contexto", () => {
    // El widget sólo se monta en el dashboard, pero la función no debe inventar contexto si igual
    // la llaman desde la landing o /admin.
    expect(ctx("/")).toEqual({ tipo: "general" })
    expect(ctx("/admin/usuarios")).toEqual({ tipo: "general" })
    expect(ctx("/login")).toEqual({ tipo: "general" })
  })

  it("la barra final no cambia la pantalla", () => {
    expect(ctx(`/dashboard/patients/${UUID_A}/`)).toEqual(ctx(`/dashboard/patients/${UUID_A}`))
    expect(ctx("/dashboard/")).toEqual(ctx("/dashboard"))
  })

  it("el uuid se acepta en mayúsculas", () => {
    const c = ctx(`/dashboard/patients/${UUID_A.toUpperCase()}`)
    expect(c.tipo).toBe("paciente")
  })
})

describe("describirContexto", () => {
  it("cubre todas las variantes y ninguna sale vacía", () => {
    const rutas = [
      `/dashboard/patients/${UUID_A}`,
      `/dashboard/consultas/${UUID_A}`,
      "/dashboard/asistente",
      "/dashboard/owners",
      "/dashboard/calendario",
      "/dashboard/comunicaciones",
      "/dashboard/facturacion",
      `/dashboard/facturacion/${UUID_A}`,
      "/dashboard",
    ]
    for (const r of rutas) {
      const t = describirContexto(ctx(r))
      expect(t.length).toBeGreaterThan(0)
      // Se le muestra al vet: no puede salir un slug ni un tipo del código.
      expect(t).not.toMatch(/[_{}]|tipo:/)
    }
  })
})
