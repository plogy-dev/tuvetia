/**
 * La factura pública sirve a un visitante SIN SESIÓN, con un token como única credencial.
 *
 * Es la única pantalla de Tuvetia que le entrega datos a alguien que no inició sesión, así que lo
 * que consulta es un contrato, no un detalle: cada columna que se agregue a ese `select` sale a
 * internet para cualquiera que tenga el enlace — y los enlaces se reenvían por WhatsApp.
 *
 * El cerrojo es una LISTA BLANCA y no una lista negra a propósito: una lista negra sólo frena lo
 * que alguien ya pensó que era sensible, y el problema son justamente las columnas en las que nadie
 * pensó. Agregar una columna acá exige agregarla también a la lista de abajo, que es el momento en
 * que uno se pregunta si de verdad tiene que salir.
 *
 * Ojo: `notes` está en la lista A PROPÓSITO desde el 24-ago. Es el campo «Observaciones» de la
 * factura y es del titular por definición. Si alguna vez hace falta una anotación interna, va en
 * una columna nueva — no reutilizando ésta.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"

const RUTA = "src/app/f/[token]/page.tsx"

/**
 * El fuente SIN comentarios.
 *
 * El archivo explica en prosa qué NO sale de acá y nombra las columnas al hacerlo, así que un
 * escaneo del texto crudo se marca a sí mismo. Es el mismo falso positivo que ya mordió al cerrojo
 * de los embeds y al del correo.
 */
const FUENTE = readFileSync(RUTA, "utf8")
  .split("\n")
  .filter((l) => {
    const t = l.trim()
    return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*")
  })
  .join("\n")

/** Las columnas de `invoices` que el visitante anónimo puede ver. */
const PERMITIDAS_FACTURA = new Set([
  "id",
  "clinic_id",
  "full_number",
  "number",
  "status",
  "issued_at",
  "due_date",
  "subtotal_cents",
  "discount_cents",
  "tax_cents",
  "total_cents",
  "paid_cents",
  "credited_cents",
  "balance_cents",
  "payer_id",
  "notes",
])

/** Devuelve las columnas de cada `.select("…")` de columnas planas del archivo. */
function selects(): string[][] {
  const out: string[][] = []
  const re = /\.select\(\s*"([^"]+)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(FUENTE)) !== null) {
    out.push(m[1].split(",").map((c) => c.trim()).filter(Boolean))
  }
  return out
}

describe("la factura pública no filtra", () => {
  it("consulta la factura con una lista explícita, nunca con *", () => {
    // `select("*")` haría que CUALQUIER columna futura de `invoices` salga sola, sin que nadie lo
    // decida: el día que se agregue un campo interno, ya estaría publicado.
    expect(FUENTE).not.toContain('.select("*")')
    expect(FUENTE).not.toContain(".select('*')")
  })

  it("toda columna que se sirve está en la lista blanca", () => {
    const columnas = selects().flat()
    expect(columnas.length).toBeGreaterThan(0)
    const deFactura = columnas.filter((c) => PERMITIDAS_FACTURA.has(c))
    expect(deFactura.length).toBeGreaterThan(5)

    // Lo que no reconoce ninguna lista se reporta con nombre, para que el rojo diga qué revisar.
    //
    // Las otras tres consultas están autorizadas por lo que SON, y vale dejarlo escrito:
    //  · `invoice_lines` — el detalle de lo que se cobra. Es la factura misma.
    //  · `clinics` y `billing_settings` — los datos del EMISOR (razón social, NIT, dirección,
    //    teléfono). En Colombia van impresos por obligación: identifican a quien cobra, no al que
    //    paga.
    //  · `owners` — SÓLO `full_name`. El adquirente se identifica con su nombre y nada más; su
    //    correo, su teléfono y su documento NO salen de acá.
    const columnasDeLinea = ["description", "qty", "unit", "unit_price_cents", "total_cents"]
    const datosDelEmisor = [
      "name",
      "phone",
      "email",
      "address",
      "city",
      "logo_url",
      "fiscal_name",
      "fiscal_id_type",
      "fiscal_id_number",
      "fiscal_address",
    ]
    const conocidas = new Set([
      ...PERMITIDAS_FACTURA,
      ...columnasDeLinea,
      ...datosDelEmisor,
      "full_name",
    ])
    const intrusas = columnas.filter((c) => !conocidas.has(c))
    expect(intrusas, `columnas sin autorizar en ${RUTA}`).toEqual([])
  })

  it("del PAGADOR sólo sale el nombre", () => {
    // Es el dato de una persona real que ni siquiera abrió sesión, y el enlace se reenvía por
    // WhatsApp. Su correo, su teléfono y su documento no tienen nada que hacer en una URL que
    // cualquiera puede abrir.
    //
    // La tabla es `billing_payers` desde el 28-ago: `invoices.payer_id` referencia al PAGADOR de
    // facturación (id propio), no a `owners` — buscándolo en `owners` el bloque «Cliente» no se
    // pintaba jamás. La garantía de privacidad es la misma: una sola columna, el nombre.
    const consultaPagador = /from\("billing_payers"\)\s*\.select\(\s*"([^"]+)"/.exec(FUENTE)
    expect(consultaPagador, "no se encontró la consulta de billing_payers").not.toBeNull()
    expect(consultaPagador![1].split(",").map((c) => c.trim())).toEqual(["name"])
    // Y el filtro por clínica tiene que seguir ahí: la consulta corre con service_role.
    expect(FUENTE).toMatch(/from\("billing_payers"\)[\s\S]{0,200}eq\("clinic_id", invoice\.clinic_id\)/)
  })

  it("NUNCA sirve las columnas internas de la factura", () => {
    // Estas existen en `invoices` y no tienen por qué salir: quién la creó, qué rango de
    // numeración consumió, y el estado del acoso de cobranza.
    for (const interna of [
      "created_by",
      "numbering_range_id",
      "reminders_paused",
      "followup_status",
      "followup_channel",
      "followup_enabled",
      "share_token",
    ]) {
      expect(selects().flat(), `«${interna}» no puede servirse sin sesión`).not.toContain(interna)
    }
  })
})
