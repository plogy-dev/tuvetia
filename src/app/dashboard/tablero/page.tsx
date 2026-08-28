import Link from "next/link"
import { addWeeks, format, startOfWeek } from "date-fns"
import { es } from "date-fns/locale/es"

import { sesionDelServidor } from "@/lib/supabase/sesion"
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
import { ventasPorTipo } from "@/lib/tablero/ventas-por-tipo"
import { VentasDelMesLazy as VentasDelMes } from "@/components/dashboard/donas-lazy"
import { pacientesPorEspecie } from "@/lib/tablero/pacientes-por-especie"
import { PacientesPorEspecieLazy as PacientesPorEspecie } from "@/components/dashboard/donas-lazy"
import { CumplimientoDeVentasLazy as CumplimientoDeVentas } from "@/components/dashboard/donas-lazy"
import {
  metricaDe,
  metricasAPintar,
  metricasEfectivas,
  type IdDeMetrica,
  type MetricasGuardadas,
} from "@/lib/tablero/metricas"
import { formatCOP } from "@/lib/facturacion/format"
import { variacion, ventanaDelMesAnterior } from "@/lib/tablero/comparacion"

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
  const { supabase, user } = await sesionDelServidor()
  // Disparada YA, awaiteada recién en el JSX del riel: costó 443ms medidos (ver layout.tsx) y
  // esperarla al final de todas las tandas se la sumaba ENTERA a la pantalla de entrada en cada
  // navegación suave (el disparo del layout no corre ahí).
  const progresoPromise = progresoDeConfiguracion()

  const now = new Date()
  // ── LOS CORTES DE «HOY» Y «MES» SON DE BOGOTÁ, NO DEL PROCESO ─────────────────────────────
  //
  // En Vercel el proceso vive en UTC: `new Date(y,m,d)` cortaba el día a las 19:00 de Colombia y
  // el mes saltaba 5 horas antes — de 19:00 a medianoche, «Citas hoy» del tablero contradecía a
  // la pantalla de Pacientes, que sí resta las 5 horas (revisión del 26-ago; es el mismo patrón
  // ya documentado en patients/page.tsx). UTC-5 fijo: Colombia no tiene horario de verano.
  const enBogota = new Date(now.getTime() - 5 * 3_600_000)
  const monthStart = new Date(Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), 1) + 5 * 3_600_000)
  const weekAhead = new Date(now.getTime() + 7 * 864e5)
  const inicioDeHoy = new Date(
    Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth(), enBogota.getUTCDate()) + 5 * 3_600_000,
  )
  const finDeHoy = new Date(inicioDeHoy.getTime() + 864e5 - 1)
  const enTreintaDias = new Date(now.getTime() + 30 * 864e5)
  const chartStart = startOfWeek(addWeeks(startOfWeek(now, { weekStartsOn: 1 }), -(WEEKS - 1)), {
    weekStartsOn: 1,
  })

  const { data: perfil } = user
    ? await supabase.from("profiles").select("clinic_id, role").eq("id", user.id).maybeSingle()
    : { data: null }
  const clinicId = (perfil as { clinic_id: string | null } | null)?.clinic_id ?? null
  // El rol decide si además del suyo puede dejar el tablero de ENTRADA de la clínica (0075). Es la
  // misma comprobación que hace la RLS: acá sólo gobierna si se ofrece el botón, no si se permite.
  const esAdmin = (perfil as { role: string | null } | null)?.role === "admin"

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
    defaultDeLaClinica,
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
            // `metricas` viaja en el MISMO select que `widgets` (0080): es la misma preferencia, de
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
      // EL TABLERO CON EL QUE ENTRA LA CLÍNICA (0075). Es el punto de PARTIDA de quien todavía no
      // armó el suyo; la preferencia de arriba le gana siempre. Va en la misma ola porque no
      // depende de ella: cuál de las dos rige lo decide `disposicionEfectiva`, no una consulta.
      clinicId
        ? supabase
            .from("tablero_default_clinica")
            .select("widgets")
            .eq("clinic_id", clinicId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ])

  // Un fallo de query no debe verse como "clínica en ceros": banner de error visible.
  const loadError = [consultasMes, pacientes, citas7d, notasRevisar, chartData, upcomingData].some(
    (r) => r.error,
  )

  const facturacionActiva =
    (ajustesDeFacturacion as { data: { module_status: string } | null }).data?.module_status === "ACTIVO"

  // QUÉ CIFRAS QUIERE ESTA PERSONA (0080), reconciliadas con las que existen hoy y filtradas por lo
  // que esta clínica puede ofrecer. Sin preferencia guardada salen las cuatro de fábrica de siempre.
  const metricasDeLaPersona = metricasEfectivas(
    (preferencia as { data: { metricas?: MetricasGuardadas } | null } | { data: null }).data?.metricas ?? null,
  )
  const metricasElegidas = metricasAPintar(metricasDeLaPersona, facturacionActiva)
  const encendida = (id: IdDeMetrica) => metricasElegidas.some((m) => m.id === id)

  // LA DISPOSICIÓN se resuelve ACÁ (sus dos orígenes vienen de la primera ola) porque la segunda
  // ola también la necesita: qué donas/anillos se piden depende de qué bloques están visibles.
  const guardadoPropio =
    (preferencia as { data: { widgets: Guardado } | null } | { data: null }).data?.widgets ?? null
  const guardadoDeLaClinica =
    (defaultDeLaClinica as { data: { widgets: Guardado } | null } | { data: null }).data?.widgets ??
    null
  const disposicion = disposicionEfectiva(guardadoPropio, guardadoDeLaClinica)
  const donaVisible =
    facturacionActiva && disposicion.some((w) => w.id === "ventas" && w.visible)
  const especiesVisible = disposicion.some((w) => w.id === "especies" && w.visible)
  const cumplimientoVisible =
    facturacionActiva && disposicion.some((w) => w.id === "cumplimiento" && w.visible)
  const ventanaAnterior = ventanaDelMesAnterior(now, monthStart)

  // ── SEGUNDA OLA: sólo lo que alguien encendió — y TODA JUNTA ─────────────────────────────────
  //
  // Va aparte de la ola grande de arriba a propósito. Estas consultas existen únicamente para las
  // cifras OPCIONALES, así que pedirlas siempre sería cobrarle consultas por carga a la mayoría
  // —que no encendió ninguna— para pintar nada. `null` cuando está apagada, y abajo se saltea.
  //
  // Las cuatro de fábrica siguen en la ola de arriba: son `count` con `head: true`, de las más
  // baratas que hay, y hacerlas condicionales enredaría la lectura a cambio de casi nada.
  //
  // Y ES UNA SOLA `Promise.all`: métricas opcionales, comparación del mes pasado, dona de ventas,
  // dona de especies y anillo de cumplimiento eran CINCO awaits seriales que solo dependían de la
  // primera ola — cinco round-trips a Supabase, uno detrás de otro, en la pantalla que más se abre
  // (auditoría 28-ago: ~150-400ms evitables por carga).
  const [
    consultasHoy,
    citasHoy,
    titulares,
    pacientesNuevos,
    vacunas,
    facturadoMes,
    porCobrar,
    consultasMesAnterior,
    facturadoMesAnterior,
    lineasDelMes,
    filasDeEspecie,
    metaDeVentas,
    ventasParaElAnillo,
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
      // `issued_at`, no `issued_on`: esa columna NUNCA existió (verificado contra el principal el
      // 26-ago) y PostgREST devolvía 42703 → data null → la métrica pintaba $0 desde que nació,
      // sin error visible porque loadError sólo mira la primera ola.
      ? supabase.from("invoices").select("total_cents").eq("status", "EMITIDA").gte("issued_at", monthStart.toISOString())
      : null,
    encendida("por-cobrar")
      // `balance_cents` y no total−paid: una nota crédito PARCIAL no cambia el status pero SÍ el
      // saldo (total − paid − credited, mantenido por refreshInvoiceStatus). Con la resta a mano,
      // el tablero inflaba la cartera y contradecía a la pantalla de Cartera.
      ? supabase.from("invoices").select("balance_cents").eq("status", "EMITIDA")
      : null,
    // ── Contra la misma altura del mes pasado (26-ago): la insignia con la flecha que pidió
    // David. La ventana la calcula `comparacion.ts` (módulo puro con test), no esta pantalla.
    encendida("consultas-mes")
      ? supabase
          .from("consultations")
          .select("*", { count: "exact", head: true })
          .gte("started_at", ventanaAnterior.desde)
          .lte("started_at", ventanaAnterior.hasta)
      : null,
    encendida("facturado-mes")
      ? supabase
          .from("invoices")
          .select("total_cents")
          .eq("status", "EMITIDA")
          .gte("issued_at", ventanaAnterior.desde)
          .lte("issued_at", ventanaAnterior.hasta)
      : null,
    // ── La dona de ventas (25-ago): la única consulta que trae FILAS del mes. El `!inner` hace
    // que el filtro por factura EMITIDA recorte las líneas de verdad.
    donaVisible
      ? supabase
          .from("invoice_lines")
          .select("total_cents, item:catalog_items(item_type), invoice:invoices!inner(status, issued_at)")
          .eq("invoice.status", "EMITIDA")
          .gte("invoice.issued_at", monthStart.toISOString())
      : Promise.resolve({ data: null }),
    // ── La dona de especies (26-ago): solo especies, tope 2.000 (holgado para el principal).
    especiesVisible
      ? supabase.from("patients").select("species").limit(2000)
      : Promise.resolve({ data: null }),
    // ── El anillo de cumplimiento (26-ago): la meta vive en `clinics` (0094).
    cumplimientoVisible && clinicId
      ? supabase
          .from("clinics")
          .select("meta_ventas_mensual_cents")
          .eq("id", clinicId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Lo vendido se REUSA cuando la pastilla «facturado-mes» ya lo pidió (misma ola): solo se
    // vuelve a pedir si el anillo está visible con la pastilla apagada.
    cumplimientoVisible && !encendida("facturado-mes")
      ? supabase
          .from("invoices")
          .select("total_cents")
          .eq("status", "EMITIDA")
          .gte("issued_at", monthStart.toISOString())
      : Promise.resolve(null),
  ])

  const sumaDe = (r: { data: unknown } | null, campo: (f: Record<string, number>) => number) =>
    ((r?.data as Record<string, number>[] | null) ?? []).reduce((s, f) => s + campo(f), 0)

  const TITULO_COMPARACION = "frente a la misma altura del mes pasado"
  /** La variación ya lista para la pastilla, o `null` si no se puede calcular honestamente. */
  const VARIACIONES: Partial<Record<IdDeMetrica, { pct: number; sube: boolean; titulo: string } | null>> = {
    "consultas-mes": (() => {
      const v = variacion(consultasMes.count ?? 0, consultasMesAnterior?.count ?? 0)
      return v ? { ...v, titulo: TITULO_COMPARACION } : null
    })(),
    "facturado-mes": (() => {
      const v = variacion(
        sumaDe(facturadoMes, (f) => f.total_cents ?? 0),
        sumaDe(facturadoMesAnterior, (f) => f.total_cents ?? 0),
      )
      return v ? { ...v, titulo: TITULO_COMPARACION } : null
    })(),
  }

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
    "por-cobrar": formatCOP(sumaDe(porCobrar, (f) => f.balance_cents ?? 0)),
  }

  // CADA CIFRA LLEVA SU CLAVE DE DETALLE. Es lo que la vuelve tocable: al abrirla, la vista pide
  // `/api/tablero/detalle?metrica=…`, que consulta CON LOS MISMOS FILTROS que el conteo de acá
  // arriba — si los dos lados se separan, el detalle termina contradiciendo a la cifra que lo abrió.
  //
  // El ORDEN es el que la persona guardó, no el del catálogo: `metricasElegidas` ya viene ordenado.
  const metrics: Pastilla[] = metricasElegidas.flatMap((p) => {
    const m = metricaDe(p.id)
    if (!m) return []
    return [
      {
        metrica: p.id,
        label: m.label,
        value: VALORES[p.id],
        hint: m.hint,
        variacion: VARIACIONES[p.id] ?? null,
      },
    ]
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

  const dona = ventasPorTipo(
    ((lineasDelMes.data as unknown as
      | { total_cents: number; item: { item_type: string | null } | null }[]
      | null) ?? []).map((l) => ({ total_cents: l.total_cents, item_type: l.item?.item_type ?? null })),
  )
  const especies = pacientesPorEspecie(
    ((filasDeEspecie.data as { species: string | null }[] | null) ?? []),
  )
  const vendidoEsteMesCents = sumaDe(facturadoMes ?? ventasParaElAnillo, (f) => f.total_cents ?? 0)

  // El día del mes EN BOGOTÁ, que es contra lo que se juzga el ritmo. Con la fecha del servidor en
  // UTC, entre las 19:00 y la medianoche de Bogotá el anillo saltaría al día siguiente y diría que
  // se va por debajo del ritmo antes de tiempo — el último día del mes, a un día entero de más.
  const diaDelMes = {
    dia: enBogota.getUTCDate(),
    dias: new Date(Date.UTC(enBogota.getUTCFullYear(), enBogota.getUTCMonth() + 1, 0)).getUTCDate(),
  }

  // Cada bloque, ya armado. Se arma TODO y se pinta lo elegido: el costo está en las consultas —que
  // ya corrieron arriba— y no en construir el JSX. Armar sólo lo visible obligaría a mover las
  // consultas adentro de cada rama y a repetir la lógica de qué se pide.
  const BLOQUES: Record<string, { nodo: React.ReactNode; ancho: string }> = {
    riel: {
      // EL RIEL DE CONFIGURACIÓN. Estuvo un tiempo en la pantalla de Athos, cuando ésa era la
      // puerta de entrada; volvió acá cuando el Dashboard volvió a ser lo primero que se ve.
      nodo: <RielConfiguracion progreso={await progresoPromise} />,
      ancho: "lg:col-span-5",
    },
    metricas: { nodo: <PastillasDelTablero pastillas={metrics} />, ancho: "lg:col-span-5" },
    grafico: { nodo: <ConsultationsChart data={series} />, ancho: "lg:col-span-3" },
    citas: { nodo: <UpcomingAppointments appointments={upcoming} />, ancho: "lg:col-span-2" },
    ventas: {
      // Sin facturación activa el bloque igual existe —la personalización lo lista— pero explica
      // qué falta en vez de pintar una dona vacía que parece un bug.
      nodo: facturacionActiva ? (
        <VentasDelMes datos={dona} />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            La dona de ventas necesita el módulo de facturación activo.
          </p>
          <Link href="/dashboard/facturacion/configuracion" className="text-xs text-primary hover:underline">
            Activarlo en Configuración de facturación
          </Link>
        </div>
      ),
      ancho: "lg:col-span-3",
    },
    especies: {
      nodo: <PacientesPorEspecie datos={especies} />,
      ancho: "lg:col-span-2",
    },
    cumplimiento: {
      // Mismo trato que la dona de ventas: sin facturación activa el bloque existe —la
      // personalización lo lista— pero explica qué falta en vez de pintar un anillo vacío.
      nodo: facturacionActiva ? (
        <CumplimientoDeVentas
          vendidoCents={vendidoEsteMesCents}
          metaCents={
            (metaDeVentas.data as { meta_ventas_mensual_cents: number | null } | null)
              ?.meta_ventas_mensual_cents ?? null
          }
          hoy={diaDelMes}
          puedeEditar={(perfil as { role: string | null } | null)?.role === "admin"}
        />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-2 rounded-xl border bg-card p-4 text-center">
          <p className="text-sm text-muted-foreground">
            El anillo de cumplimiento necesita el módulo de facturación activo.
          </p>
          <Link href="/dashboard/facturacion/configuracion" className="text-xs text-primary hover:underline">
            Activarlo en Configuración de facturación
          </Link>
        </div>
      ),
      ancho: "lg:col-span-2",
    },
    borradores: {
      nodo: <NotasPorAprobar notas={(borradores.data as unknown as NotaEnBorrador[] | null) ?? []} />,
      ancho: "lg:col-span-2",
    },
  }

  return (
    // Pasa a `PageShell` como el resto del CRM. Antes tenía su propio marco —`py-4` afuera y
    // `px-4 lg:px-6` repetido en CADA hijo—, que es de donde salía que el tablero no se alineara
    // con ninguna otra pantalla.
    //
    // `gap-4` en vez del `gap-6` del shell: el tablero apila más bloques que ninguna otra pantalla
    // y en un portátil de 768 px de alto cada separación de 24 se paga con scroll («toca escrollear
    // mucho», el cliente). Sólo se aprieta la separación vertical; el padding del marco no se toca
    // para no desalinear el tablero del resto de las pantallas.
    <PageShell className="gap-4">
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
              elegir necesita las dos: `metricasElegidas` de arriba ya viene filtrada para pintar.
              `esAdmin` es otra cosa: habilita guardar el tablero con el que ENTRA la clínica. */}
          <BotonDePersonalizar
            disposicion={disposicion}
            metricas={metricasDeLaPersona}
            facturacionActiva={facturacionActiva}
            clinicId={clinicId}
            esAdmin={esAdmin}
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
          citas obligaría a rehacer el layout. Acá cada bloque declara cuánto ocupa y se acomoda.
          `gap-4` y no `gap-6` por la misma razón que el shell de arriba: densidad para 1366×768. */}
      <div className="grid gap-4 lg:grid-cols-5">
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
