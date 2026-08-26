/**
 * Las cuatro decisiones de Felipe del 26-ago, cada una con su invariante fijado.
 *
 * Son escáneres de fuente porque la regresión probable de cada una es un refactor que descablea
 * sin romper el build — el mismo criterio de los demás cerrojos de UI del repo.
 */
import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const limpiar = (ruta: string) =>
  readFileSync(ruta, "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

describe("1 · VetGPT no responde solo, y se le dice al vet EN LA CARA", () => {
  it("Conexiones monta el aviso de primera visita", () => {
    // «un veterinario no es técnico»: la respuesta a la pregunta más importante de esa pantalla
    // (¿le va a hablar solo a mis clientes?) tiene que llegar ANTES de la decisión de conectar.
    const pagina = limpiar("src/app/dashboard/conexiones/page.tsx")
    expect(pagina).toContain("<VetgptNoRespondeSolo />")
  })

  it("el aviso promete lo que el sistema cumple: lo clínico nunca sale solo", () => {
    const aviso = limpiar("src/components/conexiones/vetgpt-no-responde-solo.tsx")
    expect(aviso).toContain("no le escribe solo")
  })

  it("el toggle de ajustes explica el estado APAGADO, que es como arranca", () => {
    // La letra pequeña vieja sólo describía el modo encendido: quien lo veía apagado no sabía
    // qué significaba eso para sus clientes.
    const ajustes = limpiar("src/components/settings/whatsapp-settings.tsx")
    expect(ajustes).toContain("así arranca")
  })
})

describe("2 · el informe por WhatsApp existe y es del vet", () => {
  it("el diálogo del informe ofrece el canal", () => {
    const dialogo = limpiar("src/components/consultas/informe-al-titular.tsx")
    expect(dialogo).toContain("Enviar por WhatsApp")
    expect(dialogo).toContain("/api/informe-al-titular/whatsapp")
  })
})

describe("3 · la factura emitida imputa el plan de salud", () => {
  it("issueInvoice llama la imputación después de EMITIDA y sin poder tumbar la emisión", () => {
    const emision = limpiar("src/lib/facturacion/invoices.ts")
    const iEmitida = emision.indexOf("status: 'EMITIDA'")
    const iImputa = emision.indexOf("imputarConsumosDelPlan(")
    expect(iEmitida, "la emisión perdió su marca").toBeGreaterThan(-1)
    expect(iImputa, "la emisión ya no imputa el plan — el contador no avanza nunca").toBeGreaterThan(
      iEmitida,
    )
    // El gate EXACTO, no sólo la presencia de la llamada: un mutante con `false &&` delante dejó
    // la llamada en el fuente pero muerta, y el escáner de presencia lo dio por bueno. Verificado.
    expect(emision).toMatch(/avisosDelPlan = invoice\.patient_id\s*\?/)
  })
})

describe("4 · el catálogo de vacunas alimenta el alta sin encerrarla", () => {
  it("el campo de vacuna ofrece el catálogo con datalist, no con un select", () => {
    // datalist y no <select>: una vacuna nueva se teclea igual, y una clínica sin catálogo no ve
    // diferencia. Cambiarlo a select rompería los meses de datos en texto libre.
    const ficha = limpiar("src/components/patient/patient-clinical-summary.tsx")
    expect(ficha).toContain('list="catalogo-de-vacunas"')
    expect(ficha).toContain('from("vaccine_types")')
  })

  it("Variables dejó de ser una tarjeta muerta en el panel", () => {
    const indice = limpiar("src/app/dashboard/administracion/page.tsx")
    expect(indice).toContain("/dashboard/administracion/variables/vacunas")
  })
})
