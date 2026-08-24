import { notFound } from "next/navigation"

import { createAdminClient } from "@/lib/supabase/admin"
import { formatCOP } from "@/lib/facturacion/format"

// La factura que ve el titular. ESTA PÁGINA YA SE ESTABA ENVIANDO Y NO EXISTÍA: tres sitios mandan
// `/f/<share_token>` —el recordatorio de cobranza (`cartera/scheduler.ts`), el correo de la factura
// (`facturacion/email.ts`) y la respuesta del agente en WhatsApp (`cartera/wa-router.ts`)— y el
// enlace daba 404. O sea que cada recordatorio de pago que salió invitaba a una página rota.
//
// SIN SESIÓN, Y EL TOKEN ES LA ÚNICA CREDENCIAL. Por eso:
//
//  · Se lee con `service_role` (el visitante es anónimo: la RLS le negaría todo) y por lo tanto cada
//    query lleva su filtro explícito. Es la misma regla que el resto del código con service_role.
//  · El token es un `uuid` con `gen_random_uuid()` (122 bits): no se adivina. Se valida la FORMA
//    antes de tocar la base, así que una URL basura no llega a ser una consulta.
//  · Sólo se sirven facturas EMITIDA y ANULADA. Un BORRADOR es un documento que el vet todavía está
//    armando y no tiene por qué ser visible aunque alguien tenga el enlace.
//  · Todo lo que no se sirve devuelve el MISMO 404: token inválido, factura inexistente y borrador
//    son indistinguibles desde afuera. Distinguirlos confirmaría que un token existe.
//  · Nada interno sale de acá: ni ids, ni el resto de la cartera del titular. Sólo esta factura,
//    su clínica y sus líneas.
//  · `notes` SÍ sale, y es a propósito: es el campo «Observaciones» que el vet escribe en la
//    factura, y una observación de la factura es para quien la recibe. Hasta el 24-ago no lo
//    escribía nadie —la columna estaba vacía en toda la base— así que al conectarlo no se publicó
//    ningún dato viejo. QUEDA DICHO PARA EL PRÓXIMO: este campo es del titular por definición. Si
//    algún día hace falta una anotación que el cliente NO deba ver, va en una columna nueva; no
//    acá.
//  · `noindex`: es una URL pública con un dato privado. `robots.txt` la desalienta además, pero el
//    meta es lo que de verdad la mantiene fuera del índice si alguien la enlaza.

export const dynamic = "force-dynamic"

export const metadata = {
  title: "Tu factura · Tuvetia",
  robots: { index: false, follow: false },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const VISIBLES = ["EMITIDA", "ANULADA"]

type Invoice = {
  id: string
  clinic_id: string
  full_number: string | null
  number: number | null
  status: string
  issued_at: string | null
  due_date: string | null
  subtotal_cents: number
  discount_cents: number
  notes: string | null
  tax_cents: number
  total_cents: number
  paid_cents: number
  credited_cents: number
  balance_cents: number
  payer_id: string | null
}

type Line = {
  description: string
  qty: number
  unit: string | null
  unit_price_cents: number
  discount_cents: number
  total_cents: number
}

function fmtFecha(valor: string | null): string {
  if (!valor) return "—"
  // Las DATE (`due_date`) se parsean como UTC por especificación; formatearlas en UTC evita que en
  // Colombia (UTC-5) el vencimiento se muestre un día antes.
  const d = new Date(valor.length === 10 ? `${valor}T00:00:00Z` : valor)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleDateString("es-CO", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" })
}

export default async function FacturaPublicaPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!UUID.test(token)) notFound()

  const admin = createAdminClient()

  const { data: invRow } = await admin
    .from("invoices")
    .select(
      "id, clinic_id, full_number, number, status, issued_at, due_date, subtotal_cents, discount_cents, tax_cents, total_cents, paid_cents, credited_cents, balance_cents, payer_id, notes",
    )
    .eq("share_token", token)
    .maybeSingle()
  const invoice = invRow as Invoice | null
  if (!invoice || !VISIBLES.includes(invoice.status)) notFound()

  const [{ data: clinicRow }, { data: settingsRow }, { data: lineRows }, { data: payerRow }] =
    await Promise.all([
      admin.from("clinics").select("name, phone, email, address, city").eq("id", invoice.clinic_id).maybeSingle(),
      admin
        .from("billing_settings")
        .select("fiscal_name, fiscal_id_type, fiscal_id_number, fiscal_address")
        .eq("clinic_id", invoice.clinic_id)
        .maybeSingle(),
      admin
        .from("invoice_lines")
        .select("description, qty, unit, unit_price_cents, discount_cents, total_cents")
        .eq("invoice_id", invoice.id)
        .order("position", { ascending: true }),
      invoice.payer_id
        ? admin.from("owners").select("full_name").eq("id", invoice.payer_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  const clinic = clinicRow as { name: string; phone: string | null; email: string | null; address: string | null; city: string | null } | null
  const settings = settingsRow as { fiscal_name: string | null; fiscal_id_type: string | null; fiscal_id_number: string | null; fiscal_address: string | null } | null
  const lines = (lineRows as Line[] | null) ?? []
  const payer = payerRow as { full_name: string } | null

  const anulada = invoice.status === "ANULADA"
  const pagada = !anulada && invoice.balance_cents <= 0
  const emisor = settings?.fiscal_name || clinic?.name || "Tu veterinaria"
  const nit = settings?.fiscal_id_number
    ? `${settings.fiscal_id_type ?? "NIT"} ${settings.fiscal_id_number}`
    : null

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:py-16">
      <div className="overflow-hidden rounded-2xl border bg-white">
        {/* Encabezado: quién cobra */}
        <div className="border-b px-6 py-5">
          <h1 className="text-lg font-semibold text-neutral-900">{emisor}</h1>
          <div className="mt-1 space-y-0.5 text-xs text-neutral-500">
            {nit && <p>{nit}</p>}
            {(settings?.fiscal_address || clinic?.address) && (
              <p>
                {settings?.fiscal_address || clinic?.address}
                {clinic?.city ? `, ${clinic.city}` : ""}
              </p>
            )}
            {clinic?.phone && <p>Tel. {clinic.phone}</p>}
            {clinic?.email && <p>{clinic.email}</p>}
          </div>
        </div>

        {/* Estado y número */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-neutral-50 px-6 py-4">
          <div>
            <p className="text-xs text-neutral-500">Factura</p>
            <p className="font-mono text-sm font-semibold text-neutral-900">
              {invoice.full_number ?? (invoice.number != null ? String(invoice.number) : "—")}
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              anulada
                ? "bg-neutral-200 text-neutral-600"
                : pagada
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-amber-100 text-amber-800"
            }`}
          >
            {anulada ? "Anulada" : pagada ? "Pagada" : "Pendiente de pago"}
          </span>
        </div>

        {/* Datos */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-b px-6 py-4 text-sm">
          {payer && (
            <div className="col-span-2">
              <dt className="text-xs text-neutral-500">Cliente</dt>
              <dd className="text-neutral-900">{payer.full_name}</dd>
            </div>
          )}
          <div>
            <dt className="text-xs text-neutral-500">Fecha</dt>
            <dd className="text-neutral-900">{fmtFecha(invoice.issued_at)}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">Vencimiento</dt>
            <dd className="text-neutral-900">{fmtFecha(invoice.due_date)}</dd>
          </div>
        </dl>

        {/* Detalle */}
        {lines.length > 0 && (
          <div className="overflow-x-auto border-b">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-neutral-500">
                  <th className="px-6 py-2 font-medium">Concepto</th>
                  <th className="px-3 py-2 text-right font-medium">Cant.</th>
                  <th className="px-3 py-2 text-right font-medium">Valor</th>
                  <th className="px-6 py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-6 py-2.5 text-neutral-900">{l.description}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                      {l.qty}
                      {l.unit ? ` ${l.unit}` : ""}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-neutral-600">
                      {formatCOP(l.unit_price_cents)}
                    </td>
                    <td className="px-6 py-2.5 text-right tabular-nums font-medium text-neutral-900">
                      {formatCOP(l.total_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totales */}
        <div className="space-y-1.5 px-6 py-4 text-sm">
          <Fila label="Subtotal" valor={invoice.subtotal_cents} />
          {invoice.discount_cents > 0 && <Fila label="Descuento" valor={-invoice.discount_cents} />}
          {invoice.tax_cents > 0 && <Fila label="Impuestos" valor={invoice.tax_cents} />}
          <Fila label="Total" valor={invoice.total_cents} fuerte />
          {invoice.paid_cents > 0 && <Fila label="Pagado" valor={-invoice.paid_cents} />}
          {invoice.credited_cents > 0 && <Fila label="Notas crédito" valor={-invoice.credited_cents} />}
          {!anulada && (
            <div className="flex items-center justify-between border-t pt-2.5 text-base font-semibold">
              <span>Saldo</span>
              <span className="tabular-nums">{formatCOP(invoice.balance_cents)}</span>
            </div>
          )}
        </div>

        {invoice.notes && (
          <div className="border-t px-6 py-4 text-sm text-neutral-600">
            <div className="mb-1 text-xs font-medium text-neutral-500">Observaciones</div>
            {/* `whitespace-pre-line` respeta los saltos que el vet escribió: una observación suele
                ser una lista corta, y en un solo párrafo se vuelve ilegible. */}
            <p className="whitespace-pre-line">{invoice.notes}</p>
          </div>
        )}

        {/* Cómo pagar: sin pasarela todavía, así que se dirige a la clínica en vez de prometer algo
            que no existe. */}
        {!anulada && !pagada && (
          <div className="border-t bg-neutral-50 px-6 py-4 text-sm text-neutral-600">
            Para pagar o resolver cualquier duda, escribile directamente a {clinic?.name ?? "la clínica"}
            {clinic?.phone ? ` al ${clinic.phone}` : ""}.
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-neutral-400">
        Este enlace es privado: no lo compartas con nadie más.
      </p>
    </main>
  )
}

function Fila({ label, valor, fuerte }: { label: string; valor: number; fuerte?: boolean }) {
  return (
    <div className={`flex items-center justify-between ${fuerte ? "font-semibold text-neutral-900" : "text-neutral-600"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatCOP(valor)}</span>
    </div>
  )
}
