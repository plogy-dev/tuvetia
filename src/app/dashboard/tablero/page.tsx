import { addWeeks, format, startOfWeek } from "date-fns"
import { es } from "date-fns/locale/es"

import { createClient } from "@/lib/supabase/server"
import { DataError } from "@/components/data-error"
import { PageHeader, PageShell } from "@/components/ui/page-shell"
import {
  PastillasDelTablero,
  type Pastilla,
} from "@/components/dashboard/pastillas-del-tablero"
import { ConsultationsChartLazy as ConsultationsChart } from "@/components/dashboard/consultations-chart-lazy"
import { BorrarEjemplo } from "@/components/onboarding/borrar-ejemplo"
import { RielConfiguracion } from "@/components/onboarding/riel-configuracion"
import { NewConsultationDrawer } from "@/components/new-consultation-drawer"
import { progresoDeConfiguracion } from "@/lib/onboarding/consultar"
import {
  UpcomingAppointments,
  type UpcomingAppointment,
} from "@/components/dashboard/upcoming-appointments"
import { BotonDePersonalizar } from "@/components/dashboard/boton-de-personalizar"
import { NotasPorAprobar, type NotaEnBorrador } from "@/components/dashboard/notas-por-aprobar"
import { disposicionEfectiva, visibles, type Guardado } from "@/lib/tablero/widgets"
import {
  metricaDe,
  metricasAPintar,
  metricasEfectivas,
  type IdDeMetrica,
  type MetricasGuardadas,
} from "@/lib/tablero/metricas"
import { formatCOP } from "@/lib/facturacion/format"

export const metadata = { title: "Dashboard · Tuvetia" }

const WEEKS = 12

// Agrupa las fechas de consulta en 12 buckets semanales (lun–dom) para el gráfico.
function weeklySeries(dates: string[]): { label: string; count: number }[] {
  const base = startOfWeek(new Date(), { weekStartsOn: 1 })
  const buckets = Array.from({ length: WEEKS }, (_, i) => {
    const start = startOfWeek(addWeeks(base, i - (WEEKS - 1)), { weekStartsOn: 1 })
    return { start, label: format(start, "d MMM", { locale: es }), count: 0 }
  })
  for (const iso of dates) {
    const wk = startOfWeek(new Date(iso), { weekStartsOn: 1 }).getTime()
    const b = buckets.find((x) => x.start.getTime() === wk)
    if (b) b.count += 1
  }
  return buckets.map(({ label, count }) => ({ label, count }))
}

export default async function DashboardPage() {
  const supabase = await createClient()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const weekAhead = new Date(now.getTime() + 7 * 864e5)
  const inicioDeHoy = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const finDeHoy = new Date(inicioDeHoy.getTime() + 864e5 - 1)
  const enTreintaDias = new Date(now.getTime() + 30 * 864e5)
  const chartStart = startOfWeek(addWeeks(startOfWeek(now, { weekStartsOn: 1 }), -(WEEKS - 1)), {
    weekStartsOn: 1,
  })

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: perfil } = user
    ? await supabase.from("profiles").select("clinic_id").eq("id", user.id).maybeSingle()
    : { data: null }
  const clinicId = (perfil as { clinic_id: string | null } | null)?.clinic_id ?? null

  const [
    consultasMes,
    pacientes,
    citas7d,
    notasRevisar,
    chartData,
    upcomingData,
    demoOwner,
    borradores,
    preferencia,
    ajustesDeFacturacion,
  ] = await Promise.all([
      supabase
        .from("consultations")
        .select("*", { count: "exact", head: true })
        .gte("started_at", monthStart.toISOString()),
      supabase.from("patients").select("*", { count: "exact", head: true }),
      supabase
        .from("appointments")
        .select("*", { count: "exact", head: true })
        .gte("starts_at", now.toISOString())
        .lte("starts_at", weekAhead.toISOString())
        // Solo estados realmente pendientes: una cita futura marcada completed/no_show no es "próxima".
        .in("status", ["scheduled", "confirmed", "in_progress"]),
      supabase.from("clinical_notes").select("*", { count: "exact", head: true }).eq("status", "draft"),
      supabase
        .from("consultations")
        .select("started_at")
        .gte("started_at", chartStart.toISOString()),
      supabase
        .from("appointments")
        .select("id, title, starts_at, status, patient:patients(name)")
        .gte("starts_at", now.toISOString())
        .in("status", ["scheduled", "confirmed", "in_progress"])
        .order("starts_at", { ascending: true })
        .limit(8),
      // Lo único que queda del viejo checklist: si hay datos de ejemplo, se ofrece borrarlos. Los
      // conteos de audios y notas aprobadas que alimentaban sus otros dos checks se fueron con él —
      // medían USO, y el riel que lo reemplazó mide CONFIGURACIÓN.
      supabase
        .from("owners")
        .select("*", { count: "exact", head: true })
        .eq("full_name", "Ejemplo — TuvetIA"),
      // Las notas en borrador, con nombre y todo: es el widget que David pidió mirar de un vistazo.
      // Cinco alcanzan — más que eso ya es la pantalla de consultas.
      supabase
        .from("clinical_notes")
        .select("id, created_at, consultation:consultations(id, patient:patients(name))")
        .eq("status", "draft")
        .order("created_at", { ascending: false })
        .limit(5),
      // CÓMO QUIERE ESTA PERSONA SU TABLERO (0072). Sin fila, sale el de fábrica: `maybeSingle` y
      // no `single` porque no tenerla es lo normal, no un error.
      user && clinicId
        ? supabase
            .from("tablero_preferencias")
            // `metricas` viaja en el MISMO select que `widgets` (0073): es la misma preferencia, de
            // la misma persona, para la misma pantalla.
            .select("widgets, metricas")
            .eq("user_id", user.id)
            .eq("clinic_id", clinicId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // ¿Factura esta clínica desde Tuvetia? Decide si se le OFRECEN las cifras de plata: a una que
      // no activó el módulo serían ceros permanentes.
      clinicId
        ? supabase.from("billing_settings").select("module_status").eq("clinic_id", clinicId).maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  // Un fallo de query no debe verse como "clínica en ceros": banner de error visible.
  const loadError = [consultasMes, pacientes, citas7d, notasRevisar, chartData, upcomingData].some(
    (r) => r.error,
  )

  const facturacionActiva =
    (ajustesDeFacturacion as { data: { module_status: string } | null }).data?.module_status === "ACTIVO"

  // QUÉ CIFRAS QUIERE ESTA PERSONA (0073), reconciliadas con las que existen hoy y filtradas por lo
  // que esta clínica puede ofrecer. Sin preferencia guardada salen las cuatro de fábrica de siempre.
  const metricasDeLaPersona = metricasEfectivas(
    (preferencia as { data: { metricas?: MetricasGuardadas } | null } | { data: null }).data?.metricas ?? null,
  )
  const metricasElegidas = metricasAPintar(metricasDeLaPersona, facturacionActiva)
  const encendida = (id: IdDeMetrica) => metricasElegidas.some((m) => m.id === id)

  // ── SEGUNDA OLA: sólo lo que alguien encendió ────────────────────────────────────────────────
  //
  // Va aparte de la ola grande de arriba a propósito. Estas consultas existen únicamente para las
  // cifras OPCIONALES, así que pedirlas siempre sería cobrarle siete consultas por carga a la
  // mayoría —que no encendió ninguna— para pintar nada. `null` cuando está apagada, y abajo se
  // saltea.
  //
  // Las cuatro de fábrica siguen en la ola de arriba: son `count` con `head: true`, de las más
  // baratas que hay, y hacerlas condicionales enredaría la lectura a cambio de casi nada.
  const [
    consultasHoy,
    citasHoy,
    titulares,
    pacientesNuevos,
    vacunas,
    facturadoMes,
    porCobrar,
  ] = await Promise.all([
    encendida("consultas-hoy")
      ? supabase.from("consultations").select("*", { count: "exact", head: true }).gte("started_at", inicioDeHoy.toISOString())
      : null,
    encendida("citas-hoy")
      ? supabase
          .from("appointments")
          .select("*", { count: "exact", head: true })
          .gte("starts_at", inicioDeHoy.toISOString())
          .lte("starts_at", finDeHoy.toISOString())
          .in("status", ["scheduled", "confirmed", "in_progress"])
      : null,
    encendida("titulares")
      ? supabase.from("owners").select("*", { count: "exact", head: true })
      : null,
    encendida("pacientes-nuevos-mes")
      ? supabase.from("patients").select("*", { count: "exact", head: true }).gte("created_at", monthStart.toISOString())
      : null,
    // `next_dose_at` es una columna DATE: se compara contra el CALENDARIO. Compararla con un
    // instante completo adelanta el vencimiento un día.
    encendida("vacunas-por-vencer")
      ? supabase
          .from("vaccines")
          .select("*", { count: "exact", head: true })
          .not("next_dose_at", "is", null)
          .lte("next_dose_at", enTreintaDias.toISOString().slice(0, 10))
      : null,
    encendida("facturado-mes")
      ? supabase.from("invoices").select("total_cents").eq("status", "EMITIDA").gte("issued_on", monthStart.toISOString().slice(0, 10))
      : null,
    encendida("por-cobrar")
      ? supabase.from("invoices").select("total_cents, paid_cents").eq("status", "EMITIDA")
      : null,
  ])

  const sumaDe = (r: { data: unknown } | null, campo: (f: Record<string, number>) => number) =>
    ((r?.data as Record<string, number>[] | null) ?? []).reduce((s, f) => s + campo(f), 0)

  /** El valor ya formateado de cada cifra. Las apagadas ni se calculan. */
  const VALORES: Record<IdDeMetrica, string> = {
    "consultas-mes": String(consultasMes.count ?? 0),
    pacientes: String(pacientes.count ?? 0),
    "citas-7d": String(citas7d.count ?? 0),
    "notas-borrador": String(notasRevisar.count ?? 0),
    "consultas-hoy": String(consultasHoy?.count ?? 0),
    "citas-hoy": String(citasHoy?.count ?? 0),
    titulares: String(titulares?.count ?? 0),
    "pacientes-nuevos-mes": String(pacientesNuevos?.count ?? 0),
    "vacunas-por-vencer": String(vacunas?.count ?? 0),
    "facturado-mes": formatCOP(sumaDe(facturadoMes, (f) => f.total_cents ?? 0)),
    "por-cobrar": formatCOP(sumaDe(porCobrar, (f) => (f.total_cents ?? 0) - (f.paid_cents ?? 0))),
  }

  // CADA CIFRA LLEVA SU CLAVE DE DETALLE. Es lo que la vuelve tocable: al abrirla, la vista pide
  // `/api/tablero/detalle?metrica=…`, que consulta CON LOS MISMOS FILTROS que el conteo de acá
  // arriba — si los dos lados se separan, el detalle termina contradiciendo a la cifra que lo abrió.
  //
  // El ORDEN es el que la persona guardó, no el del catálogo: `metricasElegidas` ya viene ordenado.
  const metrics: Pastilla[] = metricasElegidas.flatMap((p) => {
    const m = metricaDe(p.id)
    if (!m) return []
    return [{ metrica: p.id, label: m.label, value: VALORES[p.id], hint: m.hint }]
  })

  const series = weeklySeries(
    ((chartData.data as { started_at: string }[] | null) ?? []).map((c) => c.started_at),
  )
  const upcoming = (upcomingData.data as unknown as UpcomingAppointment[] | null) ?? []

  const hoy = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  })

  // LA DISPOSICIÓN DE ESTA PERSONA, reconciliada con los widgets que existen HOY (0072). Un id
  // viejo se ignora y uno nuevo aparece al final: la preferencia guardada es una foto del día que
  // se guardó, y el código sigue cambiando.
  const disposicion = disposicionEfectiva(
    ((preferencia as { data: { widgets: Guardado } | null } | { data: null }).data?.widgets ?? null),
  )

  // Cada bloque, ya armado. Se arma TODO y se pinta lo elegido: el costo está en las consultas —que
  // ya corrieron arriba— y no en construir el JSX. Armar sólo lo visible obligaría a mover las
  // consultas adentro de cada rama y a repetir la lógica de qué se pide.
  const BLOQUES: Record<string, { nodo: React.ReactNode; ancho: string }> = {
    riel: {
      // EL RIEL DE CONFIGURACIÓN. Estuvo un tiempo en la pantalla de Athos, cuando ésa era la
      // puerta de entrada; volvió acá cuando el Dashboard volvió a ser lo primero que se ve.
      nodo: <RielConfiguracion progreso={await progresoDeConfiguracion()} />,
      ancho: "lg:col-span-5",
    },
    metricas: { nodo: <PastillasDelTablero pastillas={metrics} />, ancho: "lg:col-span-5" },
    grafico: { nodo: <ConsultationsChart data={series} />, ancho: "lg:col-span-3" },
    citas: { nodo: <UpcomingAppointments appointments={upcoming} />, ancho: "lg:col-span-2" },
    borradores: {
      nodo: <NotasPorAprobar notas={(borradores.data as unknown as NotaEnBorrador[] | null) ?? []} />,
      ancho: "lg:col-span-2",
    },
  }

  return (
    // Pasa a `PageShell` como el resto del CRM. Antes tenía su propio marco —`py-4` afuera y
    // `px-4 lg:px-6` repetido en CADA hijo—, que es de donde salía que el tablero no se alineara
    // con ninguna otra pantalla.
    <PageShell>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Dashboard"
          description={`${hoy.charAt(0).toUpperCase() + hoy.slice(1)} · la clínica de un vistazo`}
        />
        <div className="flex flex-wrap items-center gap-2">
          {/* EMPEZAR LA CONSULTA DESDE ACÁ.
              El tablero volvió a ser lo primero que se ve al entrar, y hasta ahora la acción
              central del producto sólo se disparaba desde la barra lateral — que además ahora
              arranca colapsada, o sea reducida a un icono sin rótulo. Quien entra a trabajar tenía
              que buscarla.

              Es el MISMO cajón de la barra y de la pantalla de Consultas, no una copia: reusa el
              gate del plan, la ventana de invitación a Pro y el `?grabar=1` que arranca la
              grabación sola. Lo único propio es dónde se monta y cómo se llama el botón. */}
          <NewConsultationDrawer label="Empezar consulta" />
          {/* Le llega la lista COMPLETA de cifras —encendidas y apagadas— porque la pantalla de
              elegir necesita las dos: `metricasElegidas` de arriba ya viene filtrada para pintar. */}
          <BotonDePersonalizar
            disposicion={disposicion}
            metricas={metricasDeLaPersona}
            facturacionActiva={facturacionActiva}
            clinicId={clinicId}
          />
        </div>
      </div>
      {loadError && (
        <DataError>
          Algunas métricas no se pudieron cargar y pueden verse en cero. Recargá la página.
        </DataError>
      )}

      {/* UNA SOLA GRILLA DE 5 COLUMNAS para todo el tablero, y no una fila por bloque. Es lo que
          permite que el orden sea libre: con contenedores fijos, mover el gráfico debajo de las
          citas obligaría a rehacer el layout. Acá cada bloque declara cuánto ocupa y se acomoda. */}
      <div className="grid gap-6 lg:grid-cols-5">
        {visibles(disposicion).map((p) => {
          const b = BLOQUES[p.id]
          if (!b) return null
          return (
            <div key={p.id} className={b.ancho}>
              {b.nodo}
            </div>
          )
        })}
      </div>

      {(demoOwner.count ?? 0) > 0 && <BorrarEjemplo />}
    </PageShell>
  )
}
