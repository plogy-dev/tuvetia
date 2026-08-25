import "server-only"

// A quién le llega un aviso de la clínica.
//
// ── SÓLO LO OPERATIVO ─────────────────────────────────────────────────────────────────────────
//
// Esto sirve para avisos que se apoyan en la relación que el titular YA tiene con la clínica: un
// control que toca, un cambio de horario, un recordatorio. NO es para promociones — eso es
// comunicación comercial, exige base legal bajo la Ley 1581 con consentimiento registrado y su
// prueba, y es una segunda fase con su propio esquema.
//
// La distinción no es de tono: es de qué te permite hacer la ley con un dato personal que te dieron
// para otra cosa.
//
// ── LOS SEGMENTOS SON CERRADOS A PROPÓSITO ────────────────────────────────────────────────────
//
// No hay «escribí tu propia consulta» ni un «todos» pelado. Dos razones, y la segunda es la que
// importa:
//
//   · Una lista de «todos» incluye al titular que dejó la clínica hace dos años y cuyo correo ya no
//     existe. Eso es un REBOTE, y los rebotes queman la reputación del dominio.
//   · Y el dominio es UNO SOLO PARA TODAS LAS CLÍNICAS. Una lista sucia de una clínica manda a spam
//     los correos de cartera de TODAS las demás. No es teórico: es la razón por la que esta función
//     estuvo planeada y sin construir desde el 22-ago.
//
// Cada segmento está definido por algo que pasó —hay un paciente, hubo una consulta, hay una cita—
// así que las direcciones que trae son de gente que estuvo en la clínica.
//
// ── «VACUNA VENCIDA»: LA TABLA SÍ EXISTÍA ─────────────────────────────────────────────────────
//
// Al planear esto dije que el segmento no se podía ofrecer porque no había tabla de vacunaciones.
// Estaba buscando `vaccinations`: se llama `vaccines`, y trae `next_dose_at`. El segmento entró el
// 25-ago y es probablemente el más útil de los cinco — avisar de una vacuna que toca es exactamente
// el aviso operativo que una clínica quiere mandar.

import { createAdminClient } from "@/lib/supabase/admin"
import { normalizarCorreo, sinLosDeBaja } from "@/lib/email/baja"

/** Los segmentos que los datos de verdad sostienen. */
export const SEGMENTOS = {
  CON_PACIENTE: {
    etiqueta: "Titulares con paciente registrado",
    ayuda: "Todos los que tienen al menos una mascota en la clínica.",
  },
  SIN_VISITA_6M: {
    etiqueta: "Sin consulta en los últimos 6 meses",
    ayuda: "Para invitar a un control. Excluye a quien ya vino hace poco.",
  },
  SIN_VISITA_12M: {
    etiqueta: "Sin consulta en los últimos 12 meses",
    ayuda: "Los más fríos. Ojo: cuanto más viejo el dato, más probable que el correo ya no exista.",
  },
  CON_CITA_PROXIMA: {
    etiqueta: "Con cita agendada próximamente",
    ayuda: "Para avisar de un cambio de horario o de una indicación previa.",
  },
  VACUNA_VENCIDA: {
    etiqueta: "Con una vacuna vencida",
    ayuda:
      "La próxima dosis ya pasó y no hay una más nueva de la misma vacuna. Mira el último año.",
  },
} as const

export type Segmento = keyof typeof SEGMENTOS

export type Destinatario = {
  ownerId: string
  nombre: string
  email: string
  /** Su token de baja: cada correo lleva SU enlace, no uno genérico. */
  token: string
}

export type Audiencia = {
  destinatarios: Destinatario[]
  /** Cuántos quedaron fuera por haberse dado de baja. Se muestra: es su decisión, y se respeta. */
  deBaja: number
  /** Cuántos titulares del segmento no tienen correo cargado. */
  sinCorreo: number
}

/** Cuántos destinatarios se traen como mucho. Un envío más grande no es un aviso: es una campaña. */
export const TOPE = 500

function haceMeses(meses: number, ahora: Date): string {
  const d = new Date(ahora)
  d.setMonth(d.getMonth() - meses)
  return d.toISOString()
}

/**
 * Los titulares de un paciente al que se le venció una vacuna.
 *
 * ── LA TRAMPA: UNA DOSIS VIEJA NO SIGNIFICA UNA VACUNA VENCIDA ────────────────────────────────
 *
 * `vaccines` guarda APLICACIONES, una fila por pinchazo. Si a Milo le pusieron rabia en 2024 con
 * `next_dose_at` en 2025, y se la volvieron a poner en 2025 con `next_dose_at` en 2026, la fila de
 * 2024 sigue diciendo que venció — y es mentira: el perro está al día.
 *
 * Filtrar `next_dose_at <= hoy` a secas le escribiría a media clínica para avisarle de vacunas que
 * ya se pusieron, que es la clase de error que hace que el titular deje de abrir los correos.
 *
 * Por eso se agrupa por PACIENTE + NOMBRE DE VACUNA y se mira la fecha MÁS NUEVA de cada grupo. Si
 * ésa ya pasó, toca de verdad.
 *
 * ── Y UNA VENTANA HACIA ATRÁS ─────────────────────────────────────────────────────────────────
 *
 * Sólo el último año. Una vacuna que venció en 2021 no es un recordatorio: es un paciente que no
 * vuelve desde hace cuatro años, y ese correo probablemente ya no existe. Rebotes, otra vez.
 */
/**
 * Qué pacientes tienen una vacuna vencida, dadas las filas de `vaccines`.
 *
 * Se separa de la consulta porque es la parte que se puede equivocar y la única que vale la pena
 * probar: la consulta trae filas, esto decide a quién se le escribe.
 *
 * `hoy` en formato `YYYY-MM-DD`, igual que la columna `date`. Se comparan como TEXTO a propósito —
 * ese formato ordena lexicográficamente igual que cronológicamente, y convertir a `Date` metería
 * una zona horaria en una fecha civil que no la tiene.
 */
export function pacientesConVacunaVencida(
  filas: { patient_id: string; vaccine_name: string | null; next_dose_at: string }[],
  hoy: string,
): string[] {
  const ultima = new Map<string, { paciente: string; fecha: string }>()
  for (const v of filas) {
    // El nombre normalizado: «Rabia» y «rabia » son la misma vacuna, y si no se unifican cada una
    // arma su propio grupo y la vieja vuelve a parecer vencida.
    const clave = `${v.patient_id}|${(v.vaccine_name ?? "").trim().toLowerCase()}`
    const previa = ultima.get(clave)
    if (!previa || v.next_dose_at > previa.fecha) {
      ultima.set(clave, { paciente: v.patient_id, fecha: v.next_dose_at })
    }
  }

  const pacientes = new Set<string>()
  for (const { paciente, fecha } of ultima.values()) {
    if (fecha <= hoy) pacientes.add(paciente)
  }
  return [...pacientes]
}

async function titularesConVacunaVencida(
  admin: ReturnType<typeof createAdminClient>,
  clinicId: string,
  ahora: Date,
): Promise<string[]> {
  const hoy = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(ahora)
  const desde = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Bogota" }).format(
    new Date(ahora.getFullYear() - 1, ahora.getMonth(), ahora.getDate()),
  )

  // Se traen TODAS las filas con próxima dosis del último año —vencidas y por venir— porque para
  // saber si la vencida quedó relevada hace falta ver también la que la relevó.
  const { data } = await admin
    .from("vaccines")
    .select("patient_id, vaccine_name, next_dose_at")
    .eq("clinic_id", clinicId)
    .not("next_dose_at", "is", null)
    .gte("next_dose_at", desde)
    .limit(5000)

  const pacientes = pacientesConVacunaVencida(
    (data ?? []) as { patient_id: string; vaccine_name: string | null; next_dose_at: string }[],
    hoy,
  )
  if (pacientes.length === 0) return []

  const { data: filas } = await admin
    .from("patients")
    .select("owner_id")
    .eq("clinic_id", clinicId)
    .in("id", pacientes)
    .not("owner_id", "is", null)

  return [...new Set(((filas ?? []) as { owner_id: string }[]).map((p) => p.owner_id))]
}

/**
 * Arma la audiencia de un segmento.
 *
 * Se lee con `service_role` —el barrido y la vista previa corren del lado del servidor— y por eso
 * cada consulta lleva su `clinic_id` explícito, que es la regla del repo.
 */
export async function armarAudiencia(
  clinicId: string,
  segmento: Segmento,
  ahora = new Date(),
): Promise<Audiencia> {
  const admin = createAdminClient()

  // Los titulares del segmento, por id. Cada rama consulta lo suyo y devuelve ids.
  let ids: string[] | null = null

  if (segmento === "SIN_VISITA_6M" || segmento === "SIN_VISITA_12M") {
    const meses = segmento === "SIN_VISITA_6M" ? 6 : 12
    const { data: recientes } = await admin
      .from("consultations")
      .select("owner_id")
      .eq("clinic_id", clinicId)
      .gte("started_at", haceMeses(meses, ahora))
      .not("owner_id", "is", null)
      .limit(5000)
    const vinieron = new Set(
      ((recientes ?? []) as { owner_id: string }[]).map((c) => c.owner_id),
    )
    const { data: conPaciente } = await admin
      .from("patients")
      .select("owner_id")
      .eq("clinic_id", clinicId)
      .not("owner_id", "is", null)
      .limit(5000)
    const todos = new Set(
      ((conPaciente ?? []) as { owner_id: string }[]).map((p) => p.owner_id),
    )
    ids = [...todos].filter((id) => !vinieron.has(id))
  } else if (segmento === "VACUNA_VENCIDA") {
    ids = await titularesConVacunaVencida(admin, clinicId, ahora)
  } else if (segmento === "CON_CITA_PROXIMA") {
    const { data } = await admin
      .from("appointments")
      .select("owner_id")
      .eq("clinic_id", clinicId)
      .gte("starts_at", ahora.toISOString())
      .in("status", ["scheduled", "confirmed"])
      .not("owner_id", "is", null)
      .limit(5000)
    ids = [...new Set(((data ?? []) as { owner_id: string }[]).map((a) => a.owner_id))]
  } else {
    const { data } = await admin
      .from("patients")
      .select("owner_id")
      .eq("clinic_id", clinicId)
      .not("owner_id", "is", null)
      .limit(5000)
    ids = [...new Set(((data ?? []) as { owner_id: string }[]).map((p) => p.owner_id))]
  }

  if (!ids || ids.length === 0) return { destinatarios: [], deBaja: 0, sinCorreo: 0 }

  const { data: filas } = await admin
    .from("owners")
    .select("id, full_name, email, unsubscribe_token")
    .eq("clinic_id", clinicId)
    .in("id", ids.slice(0, 5000))
    .order("full_name")

  const owners = ((filas ?? []) as {
    id: string
    full_name: string | null
    email: string | null
    unsubscribe_token: string | null
  }[]).filter((o) => Boolean(o.unsubscribe_token))

  const conCorreo = owners.filter((o) => normalizarCorreo(o.email))
  const sinCorreo = owners.length - conCorreo.length

  // LA BAJA SE RESPETA ACÁ Y OTRA VEZ AL ENVIAR. Acá, para que la clínica vea el número real antes
  // de escribir; al enviar, porque entre una cosa y la otra pueden pasar diez minutos.
  const { permitidos } = await sinLosDeBaja(
    clinicId,
    conCorreo.map((o) => o.email ?? ""),
  )
  const permitidosSet = new Set(permitidos)

  const destinatarios = conCorreo
    .filter((o) => permitidosSet.has(normalizarCorreo(o.email)))
    .slice(0, TOPE)
    .map((o) => ({
      ownerId: o.id,
      nombre: o.full_name ?? "",
      email: normalizarCorreo(o.email),
      token: o.unsubscribe_token as string,
    }))

  return {
    destinatarios,
    deBaja: conCorreo.length - permitidos.length,
    sinCorreo,
  }
}
