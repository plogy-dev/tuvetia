/**
 * Los tres selectores del 25-ago: cliente en la cuenta, catálogo a la vista, paciente con lupa.
 *
 * ── POR QUÉ LOS TRES JUNTOS ───────────────────────────────────────────────────────────────────
 *
 * David los pidió por separado y eran el mismo problema: elegir una cosa conocida exigía o una
 * lista plana (paciente), o un popover escondido tras un clic (catálogo), o NAVEGAR y perder lo
 * tecleado (cliente). Los tres se resolvieron con la misma pieza —el matcher `buscarPacientes`,
 * que normaliza tildes y ñ— y este archivo cuida que ninguno regrese a su forma anterior.
 *
 * Son escáneres de fuente, como los demás cerrojos de UI del repo: la regresión probable no es
 * borrar el componente, es un refactor que lo deja de cablear.
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const sinComentarios = (ruta: string) =>
  readFileSync(ruta, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

const CARRITO = sinComentarios("src/components/facturacion/InvoiceCart.tsx")
const DRAWER = sinComentarios("src/components/new-consultation-drawer.tsx")
const ALTA = sinComentarios("src/components/create-patient-drawer.tsx")

describe("el catálogo, a la vista", () => {
  it("la cuenta vacía muestra los ítems, no un cartel que manda a buscar", () => {
    // El dato que decidió el diseño: la clínica más grande del principal tiene OCHO ítems. Con
    // ese volumen no hay que buscar — hay que mostrarlos. El cartel viejo escondía los ocho
    // detrás de un popover que sólo aparecía al enfocar la caja.
    const i = CARRITO.indexOf("Toca para agregar a la cuenta")
    expect(i, "la vitrina del catálogo desapareció del estado vacío").toBeGreaterThan(-1)
    expect(CARRITO.slice(i, i + 800)).toContain("addCatalogLine(i.id)")
  })

  it("con más ítems que la vitrina, lo dice — un tope silencioso miente", () => {
    expect(CARRITO).toContain("Se muestran 24 de")
  })

  it("el buscador tiene teclado: flechas, Enter y roles de combobox", () => {
    // No existía UN SOLO ArrowDown en el repo: cada ítem exigía soltar el teclado y agarrar el
    // ratón, en la pantalla donde más se encadena (buscar → agregar → buscar).
    // Las teclas sin comillas alrededor: el carrito usa comillas simples y este test no debe
    // fijar el estilo de comillas de otro archivo.
    for (const marca of [
      "ArrowDown",
      "ArrowUp",
      'role="combobox"',
      'role="listbox"',
      'role="option"',
      "aria-activedescendant",
    ]) {
      expect(CARRITO, `el buscador del catálogo perdió ${marca}`).toContain(marca)
    }
  })
})

describe("el paciente de la consulta, con lupa", () => {
  it("se busca con el matcher compartido, no con un <Select> plano", () => {
    expect(DRAWER).toContain("buscarPacientes")
    expect(DRAWER, "volvió el <Select> plano a Iniciar consulta").not.toContain("<SelectTrigger")
  })

  it("sin preselección: elegir al paciente es LA decisión de esa pantalla", () => {
    // El <Select> viejo marcaba el primero por alfabeto — un descuido y la grabación arrancaba
    // sobre el animal equivocado.
    expect(DRAWER).not.toMatch(/setPatientId\(list\[0\]\.id\)/)
  })

  it("el alta inline devuelve al paciente elegido, sin sacar al vet del flujo", () => {
    const i = DRAWER.indexOf("onCreated=")
    expect(i, "el drawer de consulta perdió el alta inline").toBeGreaterThan(-1)
    expect(DRAWER.slice(i, i + 300)).toContain("setPatientId(nuevo.id)")
    // Y CreatePatientDrawer respeta el contrato: con onCreated NO navega a /dashboard/patients.
    const j = ALTA.indexOf("if (onCreated)")
    expect(j, "CreatePatientDrawer perdió el modo callback").toBeGreaterThan(-1)
    expect(ALTA.slice(j, j + 400)).toContain("router.push")
  })
})
