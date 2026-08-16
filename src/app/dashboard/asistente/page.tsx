import { createClient } from "@/lib/supabase/server"
import {
  TOPE_MENSAJES,
  agruparPorPaciente,
  type MensajeFila,
  type StoredThreads,
} from "@/lib/athos-history"
import { bogotaTimeOf, bogotaTodayISO, finDelDiaBogota } from "@/lib/date-utils"
import {
  RielClinica,
  TiraClinica,
  type CitaDelRiel,
  type PendienteDelRiel,
} from "@/components/athos/riel-clinica"
import { consultarPresupuesto, type Presupuesto } from "@/lib/athos-agent/presupuesto"
import { senalesDeLaClinica } from "@/lib/senales/consultar"
import { RielConfiguracion } from "@/components/onboarding/riel-configuracion"
import { progresoDeConfiguracion } from "@/lib/onboarding/consultar"
import { Assistant, type AssistantPatient } from "./assistant"

export const metadata = { title: "Athos · Tuvetia" }

// LA PANTALLA DE INICIO. `/dashboard` redirige acá: el mockup v2 se llama "Tuvetia · Athos primero"
// y su idea es que la app abra en la conversación, con el estado de la clínica como riel al lado —
// no en un tablero de métricas con Athos escondido en una subpágina.
//
// Server component: resuelve clínica, pacientes, historial Y los datos del riel antes del primer
// paint. Todo en paralelo, porque son independientes entre sí.

/** Cuántas citas del día caben en el riel sin volverlo una segunda agenda. */
const CITAS_EN_EL_RIEL = 6

/**
 * Las peticiones que otras pantallas pueden dejar escritas con `?pedir=`.
 *
 * Es un diccionario cerrado a propósito: si el texto viniera de la URL, cualquiera podría armar un
 * enlace que le deje al veterinario una orden redactada por un tercero esperando en el compositor.
 * Una clave desconocida simplemente no escribe nada.
 */
const PETICIONES: Record<string, string> = {
  cobros: "Ponete al día con los cobros vencidos: decime a quién le escribirías y qué le dirías.",
}

/** `HH:mm` y nada más. Cualquier otra cosa se descarta. */
const HORA = /^\d{2}:\d{2}$/

/**
 * La petición del hueco libre, que SÍ lleva datos de la URL — la hora y los minutos.
 *
 * Por eso se validan con formato antes de usarse y se INTERPOLAN en una plantilla nuestra, en vez
 * de concatenar lo que venga. La frase la escribimos nosotros; de la URL sólo salen dos números que
 * tienen que parecerse a una hora y a una duración, o no sale nada.
 */
function peticionDeHueco(desde?: string, minutos?: string): string | undefined {
  if (!desde || !HORA.test(desde)) return undefined
  const n = Number(minutos)
  if (!Number.isInteger(n) || n <= 0 || n > 12 * 60) return undefined
  return `Tengo ${n} minutos libres a las ${desde} de hoy. ¿A quién le vendría bien y qué le escribirías para ofrecérselo?`
}

function saludo(hora: number): string {
  if (hora < 12) return "Buenos días"
  if (hora < 19) return "Buenas tardes"
  return "Buenas noches"
}

export default async function AsistentePage({
  searchParams,
}: {
  // `?patient=` lo pone el historial del sidebar al abrir un chat ya existente.
  // `?pedir=` lo pone "Resolverlo con Athos" del riel: deja la petición escrita y lista para enviar.
  searchParams: Promise<{ patient?: string; pedir?: string; desde?: string; minutos?: string }>
}) {
  const { patient: patientParam, pedir, desde, minutos } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let clinicId = ""
  // El cupo de IA del mes. Se resuelve abajo, con la clínica ya conocida; si no hay tope
  // configurado `consultarPresupuesto` ni consulta la base y el riel no pinta nada.
  let presupuesto: Presupuesto | null = null
  let nombreVet: string | null = null
  let patients: AssistantPatient[] = []
  let threads: StoredThreads = {}
  let consultasHoy = 0
  let ventasMesCents = 0
  let carteraVencidaCents = 0
  let citas: CitaDelRiel[] = []
  let pendientes: PendienteDelRiel[] = []
  // El resumen del dia. `null` si el cron no corrio, si la clinica lo apago, o si no habia nada
  // que contar: en los tres casos el riel simplemente no lo pinta.
  let briefing: string | null = null
  let facturacionActiva = false

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("clinic_id, full_name")
      .eq("id", user.id)
      .maybeSingle()
    const p = profile as { clinic_id: string | null; full_name: string | null } | null
    clinicId = p?.clinic_id ?? ""
    nombreVet = p?.full_name ?? null

    if (clinicId) {
      presupuesto = await consultarPresupuesto(clinicId)
      const hoy = bogotaTodayISO()
      const finDeHoy = finDelDiaBogota(hoy)
      // El primer día del mes EN BOGOTÁ, no en UTC: el 1° a las 00:30 de Bogotá todavía es el mes
      // anterior en UTC, y "ventas del mes" arrancaría contando desde el mes pasado.
      const inicioDeMes = `${hoy.slice(0, 7)}-01`
      const arranqueDeHoy = `${hoy}T00:00:00-05:00`

      const [pts, msgs, consultas, facturas, citasData, billing] = await Promise.all([
        supabase
          .from("patients")
          .select("id,name,species")
          .eq("clinic_id", clinicId)
          .order("name")
          .limit(500),
        // La RLS ya acota por clínica; el patient_id null es la consulta general, que el backend
        // trata como sin estado y por eso se descarta acá.
        supabase
          .from("athos_messages")
          .select("id,patient_id,role,content,created_at")
          .eq("clinic_id", clinicId)
          .not("patient_id", "is", null)
          .in("role", ["user", "assistant"])
          .order("created_at", { ascending: false })
          .limit(TOPE_MENSAJES),
        supabase
          .from("consultations")
          .select("*", { count: "exact", head: true })
          .gte("started_at", arranqueDeHoy),
        // Se traen las filas y se suman acá en vez de pedirle un SUM a PostgREST: son las facturas
        // de UN mes, y el agregado por REST obliga a una vista o una RPC para algo que cabe en un
        // par de kilobytes. Si un día una clínica emite miles al mes, esto pasa a ser una RPC.
        supabase
          .from("invoices")
          .select("total_cents, balance_cents, due_date, issued_at, status")
          .eq("status", "EMITIDA")
          .gte("issued_at", `${inicioDeMes}T00:00:00-05:00`),
        supabase
          .from("appointments")
          .select("id, title, starts_at, status, patient:patients(name)")
          .gte("starts_at", arranqueDeHoy)
          .lte("starts_at", (finDeHoy ?? new Date()).toISOString())
          .in("status", ["scheduled", "confirmed", "in_progress"])
          .order("starts_at", { ascending: true })
          .limit(CITAS_EN_EL_RIEL),
        supabase.from("billing_settings").select("module_status").maybeSingle(),
      ])

      patients = (pts.data as AssistantPatient[] | null) ?? []
      threads = agruparPorPaciente((msgs.data as MensajeFila[] | null) ?? [])
      consultasHoy = consultas.count ?? 0
      facturacionActiva =
        (billing.data as { module_status: string } | null)?.module_status === "ACTIVO"

      const filas =
        (facturas.data as
          | { total_cents: number; balance_cents: number; due_date: string | null }[]
          | null) ?? []
      ventasMesCents = filas.reduce((s, f) => s + (f.total_cents ?? 0), 0)

      // Vencida = con saldo y con fecha de vencimiento ya pasada. Se compara contra la fecha de
      // Bogotá, no contra `new Date()`: `due_date` es una columna DATE, o sea el calendario del
      // negocio, y compararla con un instante UTC adelanta el vencimiento un día.
      carteraVencidaCents = filas
        .filter((f) => (f.balance_cents ?? 0) > 0 && f.due_date && f.due_date < hoy)
        .reduce((s, f) => s + (f.balance_cents ?? 0), 0)
      // `vencidas` (el CONTEO) se fue con la lista armada a mano: ahora lo calcula
      // `senalesDeLaClinica`. `carteraVencidaCents` se queda porque el riel muestra el MONTO en su
      // propia fila, aparte de los pendientes.

      type CitaFila = {
        id: string
        title: string | null
        starts_at: string
        status: string
        patient: { name: string } | { name: string }[] | null
      }
      citas = ((citasData.data as unknown as CitaFila[] | null) ?? []).map((c) => {
        const pac = Array.isArray(c.patient) ? c.patient[0] : c.patient
        return {
          id: c.id,
          hora: bogotaTimeOf(c.starts_at),
          etiqueta: [pac?.name, c.title].filter(Boolean).join(" · ") || "Cita",
          sinConfirmar: c.status === "scheduled",
        }
      })

      // LAS SEÑALES DE LA CLÍNICA, no sólo cartera. Acá había una lista armada a mano con un único
      // pendiente —los cobros vencidos— y el propio `TiraClinica` lo admitía en un comentario:
      // «hoy `pendientes` trae como mucho cartera». Ahora vienen de `lib/senales/`, que es la MISMA
      // fuente que alimenta el prompt de Athos: si el riel dice "3 notas sin aprobar", Athos dice lo
      // mismo, porque leen del mismo lugar.
      //
      // Los cobros vencidos siguen calculándose acá arriba para `carteraVencidaCents`, que el riel
      // muestra aparte; a las señales se les pasa ya contado para no repetir la consulta.
      {
        const [{ pendientes: senales }, { data: br }] = await Promise.all([
          senalesDeLaClinica(supabase, clinicId, hoy),
          // Lo escribe el cron con service_role; acá se lee con la sesion del vet y la RLS de
          // `clinic_briefings` lo acota a su clinica.
          supabase
            .from("clinic_briefings")
            .select("texto")
            .eq("clinic_id", clinicId)
            .eq("fecha", hoy)
            .maybeSingle(),
        ])
        pendientes = senales
        briefing = (br as { texto: string } | null)?.texto ?? null
      }
    }
  }

  // Sólo se acepta un paciente que exista y sea de esta clínica: `patients` ya viene filtrado por
  // `clinic_id`, así que un id ajeno o inventado en la URL simplemente se ignora.
  const initialPatientId =
    patientParam && patients.some((p) => p.id === patientParam) ? patientParam : undefined

  // El nombre de pila alcanza y sobra: "Buenos días, María" se lee como alguien hablándole, que es
  // el tono del mockup. El apellido lo vuelve una notificación del sistema.
  const primerNombre = nombreVet?.trim().split(/\s+/)[0] ?? null
  const horaBogota = Number(bogotaTimeOf(new Date().toISOString()).slice(0, 2))

  return (
    <div className="flex min-h-0 flex-1">
      <Assistant
        clinicId={clinicId}
        patients={patients}
        threads={threads}
        initialPatientId={initialPatientId}
        saludo={`${saludo(horaBogota)}${primerNombre ? `, ${primerNombre}` : ""}`}
        contexto={resumenDelDia({ citas: citas.length, consultasHoy, pendientes })}
        // Por debajo de `xl` el riel de la derecha no se pinta. Sin esto, en un teléfono la app
        // abría sin decir cuántas citas hay hoy ni que hay cobros vencidos.
        tiraClinica={
          <TiraClinica citas={citas} pendientes={pendientes} presupuesto={presupuesto} />
        }
        // Se DEJA ESCRITO, no se envía. Un botón que dispara una petición al agente sin que el vet
        // vea qué se pidió es una caja negra; dejarlo en el compositor le da la última palabra —
        // que es la misma regla que gobierna todo lo demás acá.
        textoInicial={
          pedir === "hueco" ? peticionDeHueco(desde, minutos) : pedir ? PETICIONES[pedir] : undefined
        }
        // El riel de configuración se mudó acá desde el tablero: ésta pasó a ser la pantalla de
        // inicio, y un recordatorio de "te falta configurar la clínica" en una pantalla que ya nadie
        // abre primero no recuerda nada. Va en la COLUMNA y no en el `aside` porque el aside es
        // `xl:` para arriba, y en un portátil de 13" desaparecería justo para quien recién empieza.
        riel={<RielConfiguracion progreso={await progresoDeConfiguracion()} />}
      />
      <RielClinica
        consultasHoy={consultasHoy}
        ventasMesCents={ventasMesCents}
        carteraVencidaCents={carteraVencidaCents}
        citas={citas}
        pendientes={pendientes}
        mostrarDinero={facturacionActiva}
        presupuesto={presupuesto}
        briefing={briefing}
      />
    </div>
  )
}

/** La línea bajo el saludo: datos del día, no un eslogan. Es lo que el mockup pone ahí. */
function resumenDelDia({
  citas,
  consultasHoy,
  pendientes,
}: {
  citas: number
  consultasHoy: number
  pendientes: PendienteDelRiel[]
}): string {
  const hoy = new Date().toLocaleDateString("es-CO", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Bogota",
  })
  const partes = [hoy.charAt(0).toUpperCase() + hoy.slice(1)]
  partes.push(citas === 1 ? "1 cita" : `${citas} citas`)
  if (consultasHoy > 0) {
    partes.push(consultasHoy === 1 ? "1 consulta registrada" : `${consultasHoy} consultas registradas`)
  }
  if (pendientes.length > 0) partes.push(pendientes[0].etiqueta)
  return partes.join(" · ")
}
