import { createClient } from "@/lib/supabase/server"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import { GestionDelPlan } from "@/components/planes/gestion-del-plan"
import { historialDeCobros, planDeLaClinica } from "@/lib/suscripcion/consultar"
import { precioProCentavos } from "@/lib/planes/precio"
import { wompiConfigurado } from "@/lib/wompi/config"
import { formatCOP, fmtDate } from "@/lib/facturacion/format"

// La pantalla de Plan. Se llega desde el menú del perfil, entre Configuración y Cerrar sesión.
//
// LA VEN TODOS, NO SÓLO EL ADMINISTRADOR. Un veterinario también necesita entender por qué Athos le
// pide subir de plan; esconderle la pantalla lo dejaría sin ninguna explicación de por qué no puede
// usar la mitad del producto. Lo que no puede es contratar, y eso se lo dice la pantalla.

export const metadata = { title: "Plan · Tuvetia" }
export const dynamic = "force-dynamic"

/** Cómo se lee cada estado de cobro en el historial. */
const ESTADO_COBRO: Record<string, string> = {
  APROBADO: "Pagado",
  RECHAZADO: "Rechazado",
  PENDIENTE: "Procesando",
  ERROR: "Error",
  ANULADO: "Anulado",
}

const MOTIVO_COBRO: Record<string, string> = {
  alta: "Primer pago",
  renovacion: "Renovación",
  reintento: "Reintento",
}

export default async function PlanPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: perfil } = user
    ? await supabase.from("profiles").select("clinic_id, role").eq("id", user.id).maybeSingle()
    : { data: null }
  const p = perfil as { clinic_id: string | null; role: string | null } | null

  // Las tres lecturas son independientes: van en paralelo. `wompiConfigurado` no toca la red — sólo
  // mira las variables de entorno.
  const [estadoDelPlan, historial] = await Promise.all([
    planDeLaClinica(supabase, p?.clinic_id ?? null),
    historialDeCobros(supabase),
  ])

  return (
    <PageShell width="narrow">
      <PageHeader
        title="Plan"
        description="Qué incluye tu plan y cómo cambiarlo."
      />

      <GestionDelPlan
        plan={estadoDelPlan.plan}
        estado={estadoDelPlan.estado}
        renuevaEn={estadoDelPlan.renuevaEn}
        cancelado={estadoDelPlan.cancelado}
        tarjeta={estadoDelPlan.tarjeta}
        precioCentavos={precioProCentavos()}
        esAdmin={p?.role === "admin"}
        pagosDisponibles={wompiConfigurado()}
      />

      {/* ── Historial ──────────────────────────────────────────────────────────────────────────
          Sólo si hay algo. Una tabla vacía con "todavía no hay cobros" bajo una comparación de
          planes es ruido: quien está en free no tiene por qué ver un espacio reservado a facturas
          que nunca pidió. */}
      {historial.length > 0 && (
        <div className="mt-6 rounded-xl border border-line bg-card p-4">
          <h3 className="text-sm font-semibold text-fg">Historial de pagos</h3>
          <div className="mt-3 -mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-line-soft text-left text-[11px] font-semibold tracking-[0.06em] text-fg-faint uppercase">
                  <th className="py-2 pr-3">Fecha</th>
                  <th className="py-2 pr-3">Concepto</th>
                  <th className="py-2 pr-3">Período</th>
                  <th className="py-2 pr-3 text-right">Monto</th>
                  <th className="py-2 text-right">Estado</th>
                </tr>
              </thead>
              <tbody>
                {historial.map((c) => (
                  <tr key={c.id} className="border-b border-line-soft last:border-0">
                    <td className="py-2.5 pr-3 whitespace-nowrap text-fg-muted">{fmtDate(c.fecha)}</td>
                    <td className="py-2.5 pr-3">{MOTIVO_COBRO[c.motivo] ?? c.motivo}</td>
                    <td className="py-2.5 pr-3 whitespace-nowrap text-fg-muted">
                      {c.periodoInicio && c.periodoFin
                        ? `${fmtDate(c.periodoInicio)} — ${fmtDate(c.periodoFin)}`
                        : "—"}
                    </td>
                    <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                      {formatCOP(c.montoCentavos)}
                    </td>
                    <td className="py-2.5 text-right">{ESTADO_COBRO[c.estado] ?? c.estado}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </PageShell>
  )
}
