/**
 * Una transición que puede rechazar deja los botones muertos hasta recargar. No puede haber más.
 *
 * ── LO QUE PASÓ (28-ago, reporte de David) ────────────────────────────────────────────────────
 *
 * «Botones en general» dejan de responder después de un uso o dos.
 *
 * El mecanismo es de React, no de este repo: si la promesa que se le pasa a
 * `startTransition(async …)` RECHAZA, la transición NUNCA se cierra. `isPending` se queda en
 * `true`, y todo botón con `disabled={isPending}` queda apagado para siempre. Como el panel no se
 * desmonta, no hay estado nuevo que lo rescate: sólo recargar la página.
 *
 * Duele en proporción a cuántos botones comparten la bandera. En `InvoiceActionsPanel` eran OCHO
 * —emitir, descartar, cobrar, anular, los envíos— apagándose todos con un solo fallo.
 *
 * ── POR QUÉ NO ALCANZA CON QUE LOS SERVER ACTIONS ATRAPEN ─────────────────────────────────────
 *
 * Atrapan lo suyo, y están bien escritos: 11 de 12 archivos `'use server'` tienen tantos `try`
 * como funciones exportadas. Pero un `try` DENTRO del action no puede atrapar un fallo de
 * TRANSPORTE, que ocurre antes de que el action exista: sesión vencida, red caída, o un id de
 * Server Action que ya no está porque se desplegó con la pestaña abierta — que no es hipotético,
 * es la razón por la que `next.config.ts` fija `deploymentId`.
 *
 * ── POR QUÉ UNA LISTA Y NO 22 ARREGLOS DE UNA ────────────────────────────────────────────────
 *
 * Se arreglaron a mano los tres paneles donde más botones cuelgan de la misma bandera. Los otros
 * 19 quedan anotados acá, a la vista y contados. La regla es simple y es la que hace que esto
 * sirva de algo: **la lista sólo puede achicarse**. Un archivo nuevo con el defecto rompe la
 * prueba; sacar uno de la lista sin arreglarlo, también.
 *
 * Es el mismo trato que `el-ancho-no-corta.test.ts` le da a las clases de Tailwind: no se puede
 * medir sin navegador, pero la PRESENCIA de la guarda sí — y así se rompe en el PR y no en la
 * captura del cliente.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join, sep } from "node:path"

import { describe, expect, it } from "vitest"

/** Los que faltan. Esta lista SÓLO PUEDE ACHICARSE. */
const PENDIENTES = [
  "src/components/avisos/panel-de-avisos.tsx",
  "src/components/cartera/HumanTasksPanel.tsx",
  "src/components/cartera/PlantillasDeRecordatorio.tsx",
  "src/components/cartera/RunSweepButton.tsx",
  "src/components/facturacion/CatalogItemForm.tsx",
  "src/components/facturacion/CatalogItemsTab.tsx",
  "src/components/facturacion/ExpenseForm.tsx",
  "src/components/facturacion/FinanceTable.tsx",
  "src/components/facturacion/ImportBatchesList.tsx",
  "src/components/facturacion/IncomeForm.tsx",
  "src/components/facturacion/InvoiceCart.tsx",
  "src/components/facturacion/MovementForm.tsx",
  "src/components/facturacion/PurchaseDetailActions.tsx",
  "src/components/facturacion/PurchaseForm.tsx",
  "src/components/facturacion/RecipeEditor.tsx",
  "src/components/facturacion/SettingsForm.tsx",
  "src/components/facturacion/SupplierManager.tsx",
  "src/components/settings/confirmacion-citas-settings.tsx",
  "src/components/settings/recordatorio-citas-settings.tsx",
]

/** Los que ya se arreglaron. Sin esto, «achicar la lista» se puede hacer borrando líneas. */
const YA_ARREGLADOS = [
  "src/components/cartera/FollowupActions.tsx",
  "src/components/facturacion/CategoryManager.tsx",
  "src/components/facturacion/InvoiceActionsPanel.tsx",
]

function componentes(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) componentes(p, acc)
    else if (e.name.endsWith(".tsx")) acc.push(p)
  }
  return acc
}

// Los comentarios se quitan ANTES de buscar, o el propio comentario que explica el defecto cuenta
// como una ocurrencia del defecto. (Pasó al escribir esta prueba.)
const sinComentarios = (s: string) =>
  s
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")

/** El bloque `{…}` balanceado que arranca en la primera llave después de `desde`. */
function cuerpo(s: string, desde: number): string {
  const i = s.indexOf("{", desde)
  if (i < 0) return ""
  let abiertas = 0
  for (let j = i; j < s.length; j++) {
    if (s[j] === "{") abiertas++
    else if (s[j] === "}") {
      abiertas--
      if (!abiertas) return s.slice(i, j + 1)
    }
  }
  return s.slice(i)
}

function sinGuarda(): string[] {
  const malos: string[] = []
  for (const ruta of componentes("src")) {
    const s = sinComentarios(readFileSync(ruta, "utf8"))
    const re = /startTransition\(\s*async/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      if (!/\btry\s*\{/.test(cuerpo(s, m.index))) {
        malos.push(ruta.split(sep).join("/"))
        break
      }
    }
  }
  return malos.sort()
}

describe("ningún botón se queda muerto", () => {
  it("no aparecen transiciones sin guarda fuera de las ya anotadas", () => {
    const nuevos = sinGuarda().filter((r) => !PENDIENTES.includes(r))
    expect(
      nuevos,
      "un `startTransition(async …)` sin `try` deja `isPending` en true si la promesa rechaza, " +
        "y con él todos los botones que compartan la bandera — hasta recargar la página",
    ).toEqual([])
  })

  it("los tres paneles ya arreglados no vuelven atrás", () => {
    const malos = sinGuarda()
    for (const r of YA_ARREGLADOS) {
      expect(malos, `${r} volvió a quedar sin guarda`).not.toContain(r)
      expect(PENDIENTES, `${r} no puede estar en la lista de pendientes`).not.toContain(r)
    }
  })

  it("la lista de pendientes sólo puede achicarse", () => {
    // 19 es el número del 28-ago, el día que se midió. Bajarlo exige arreglar; subirlo, romper.
    expect(PENDIENTES.length).toBeLessThanOrEqual(19)
    // Y no puede tener nombres inventados: un pendiente que ya no existe es una línea que sobra.
    const malos = sinGuarda()
    expect(PENDIENTES.filter((r) => !malos.includes(r))).toEqual([])
  })
})
