import { describe, expect, it } from "vitest"

import { isNavActive } from "@/lib/nav-active"

describe("isNavActive", () => {
  it("enciende el ítem cuando la ruta es exactamente la suya", () => {
    expect(isNavActive("/dashboard/patients", "/dashboard/patients")).toBe(true)
    expect(isNavActive("/dashboard/ayuda", "/dashboard/ayuda")).toBe(true)
  })

  it("enciende la sección desde sus rutas anidadas", () => {
    // El caso que motivó todo: las 16 páginas de facturación no encendían nada.
    expect(isNavActive("/dashboard/facturacion/catalogo", "/dashboard/facturacion")).toBe(true)
    expect(isNavActive("/dashboard/facturacion/inventario/importar", "/dashboard/facturacion")).toBe(
      true,
    )
    expect(isNavActive("/dashboard/patients/abc-123", "/dashboard/patients")).toBe(true)
    expect(isNavActive("/dashboard/consultas/abc-123", "/dashboard/consultas")).toBe(true)
  })

  it("deja Dashboard apagado en el resto del panel", () => {
    // Por prefijo, "/dashboard" encendería las 30+ pantallas a la vez.
    expect(isNavActive("/dashboard", "/dashboard")).toBe(true)
    expect(isNavActive("/dashboard/patients", "/dashboard")).toBe(false)
    expect(isNavActive("/dashboard/facturacion/catalogo", "/dashboard")).toBe(false)
  })

  it("no confunde dos secciones que comparten el comienzo del nombre", () => {
    // Sin el separador "/" del prefijo, Conexiones encendería también Consultas y viceversa.
    expect(isNavActive("/dashboard/consultas", "/dashboard/conexiones")).toBe(false)
    expect(isNavActive("/dashboard/conexiones", "/dashboard/consultas")).toBe(false)
    expect(isNavActive("/dashboard/patients-x", "/dashboard/patients")).toBe(false)
  })

  it("no enciende nada desde fuera del panel", () => {
    expect(isNavActive("/login", "/dashboard/patients")).toBe(false)
    expect(isNavActive("/", "/dashboard")).toBe(false)
  })
})
