// Los campos de una propuesta de Athos, listos para pintar como lista de definición en la tarjeta.
//
// POR QUÉ EXISTE, Y NO ES SÓLO ESTÉTICA. El mockup del cliente dibuja la tarjeta con una lista
// `etiqueta → valor` (Paciente, Titular, Fecha, Duración, Motivo, Aviso). Nosotros pintábamos
// únicamente `action.summary`, una frase que arma la tool. Y esa frase NO contiene todo lo que se
// va a escribir:
//
//   · `create_owner` resume como `Crear titular "Camila Ospina" (3104482291)` — el correo, el
//     documento, la dirección y las notas que el modelo haya inventado **no se ven**, y se guardan
//     igual al aprobar.
//   · `create_appointment` resume título, fecha, hora y duración, pero **no el motivo**, que es
//     obligatorio en el payload y termina en la agenda.
//   · `create_patient` resume nombre y especie; raza, nacimiento y peso viajan invisibles.
//
// O sea que el vet estaba aprobando campos que nunca vio. La lista los pone delante ANTES del
// botón, que es el único momento en que revisarlos sirve de algo.
//
// LO QUE NO SE MUESTRA: los uuid (`patient_id`, `owner_id`, `appointment_id`). Para una persona no
// son información, y una fila "Paciente · 8f3a…" es peor que ninguna fila. El mockup muestra ahí el
// NOMBRE del paciente, que nosotros no tenemos en el payload — resolverlo obliga a una consulta por
// tarjeta en las cinco pantallas que la montan. Queda anotado como lo que falta para igualar el
// mockup; el resto de la lista no depende de eso.
//
// Los tres tools de mensajería (`send_whatsapp_message`, `send_email`, `reply_email`) devuelven
// lista vacía a propósito: sus campos ya se pintan como formulario EDITABLE en la tarjeta, y
// repetirlos arriba en sólo lectura sería mostrar dos veces el mismo dato con distinta verdad.
//
// La forma del payload es la de `payload-schemas.ts`, que es lo que de verdad hay guardado en
// `athos_actions.payload` — no el `inputSchema` de la tool, que describe lo que escribe el modelo
// antes de transformarse.

import { SEVERIDAD_ALERGIA } from "@/lib/alergias"
import { APPOINTMENT_STATUS, type AppointmentStatus } from "@/lib/appointments"
import { bogotaDateOnly, bogotaDateTime } from "@/lib/date-utils"

export type CampoDeAccion = { etiqueta: string; valor: string }

/**
 * Duplica los mapas de `patients-explorer.tsx` y `patients/[id]/page.tsx`. Consolidar los cuatro
 * que hay en el repo es una limpieza aparte; meterla acá arrastraría cuatro pantallas a un cambio
 * de tarjeta.
 */
const SEXO: Record<string, string> = { male: "Macho", female: "Hembra", unknown: "Sin dato" }

// Las severidades salen de `lib/alergias.ts`, que es el mismo mapa que usan la ficha del paciente y
// la marca dentro del plan. Tres copias de "severe → severa" es como terminan diciendo cosas
// distintas en tres pantallas sobre el mismo dato.

/** Descarta null, undefined y cadenas en blanco: una fila vacía ocupa lugar y no dice nada. */
function texto(v: unknown): string | null {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : null
  if (typeof v !== "string") return null
  const t = v.trim()
  return t.length > 0 ? t : null
}

function fila(etiqueta: string, valor: unknown): CampoDeAccion[] {
  const v = texto(valor)
  return v ? [{ etiqueta, valor: v }] : []
}

/** "4,5 kg" — coma decimal, que es como se escribe un peso en Colombia. */
function peso(v: unknown): CampoDeAccion[] {
  if (typeof v !== "number" || !Number.isFinite(v)) return []
  return [{ etiqueta: "Peso", valor: `${new Intl.NumberFormat("es-CO").format(v)} kg` }]
}

/**
 * "30 min" salido de la diferencia entre los dos instantes. El payload guardado ya no tiene
 * `duration_min`: la tool lo resolvió a `starts_at`/`ends_at` antes de proponer.
 */
function duracion(desde: unknown, hasta: unknown): CampoDeAccion[] {
  if (typeof desde !== "string" || typeof hasta !== "string") return []
  const a = Date.parse(desde)
  const b = Date.parse(hasta)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return []
  return [{ etiqueta: "Duración", valor: `${Math.round((b - a) / 60000)} min` }]
}

/** Una fecha ISO ya formateada en la zona del negocio; si no parsea, no se muestra nada. */
function cuando(iso: unknown): CampoDeAccion[] {
  if (typeof iso !== "string" || !Number.isFinite(Date.parse(iso))) return []
  return [{ etiqueta: "Cuándo", valor: bogotaDateTime(iso) }]
}

/** Los campos del titular, con el prefijo que los distingue cuando van junto a los del paciente. */
function camposDeTitular(o: Record<string, unknown>, prefijo = ""): CampoDeAccion[] {
  return [
    ...fila(prefijo ? `${prefijo} · nombre` : "Nombre", o.full_name),
    ...fila("Teléfono", o.phone),
    ...fila("Correo", o.email),
    ...fila("Documento", o.document_id),
    ...fila("Dirección", o.address),
    ...fila("Notas", o.notes),
  ]
}

function camposDePaciente(p: Record<string, unknown>, prefijo = ""): CampoDeAccion[] {
  return [
    ...fila(prefijo ? `${prefijo} · nombre` : "Nombre", p.name),
    ...fila("Especie", p.species),
    ...fila("Sexo", typeof p.sex === "string" ? SEXO[p.sex] : null),
    ...fila("Raza", p.breed),
    ...fila("Nacimiento", typeof p.birth_date === "string" ? bogotaDateOnly(p.birth_date) : null),
    ...peso(p.weight_kg),
  ]
}

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

const POR_TOOL: Record<string, (p: Record<string, unknown>) => CampoDeAccion[]> = {
  create_appointment: (p) => [
    ...fila("Título", p.title),
    // El payload GUARDADO trae `starts_at`/`ends_at` (la tool los resolvió a ISO antes de proponer).
    // Pero la tarjeta EN VIVO del chat recibe el `input` crudo del modelo —`date`/`time`/
    // `duration_min`— porque la propuesta todavía no pasó por la DB. Se manejan las dos formas para
    // que el vet vea la hora también mientras Athos la propone, no sólo al recargar.
    ...(typeof p.starts_at === "string"
      ? [...cuando(p.starts_at), ...duracion(p.starts_at, p.ends_at)]
      : [
          ...fila("Fecha", typeof p.date === "string" ? bogotaDateOnly(p.date) : null),
          ...fila("Hora", p.time),
          ...fila("Duración", typeof p.duration_min === "number" ? `${p.duration_min} min` : null),
        ]),
    ...fila("Motivo", p.reason),
    ...fila("Notas", p.notes),
  ],

  // Sólo trae los campos que CAMBIAN, así que la lista es justo el cambio propuesto. Acá `date` y
  // `time` sí vienen sueltos (el payload de update no se resuelve a ISO).
  update_appointment: (p) => [
    ...fila("Título", p.title),
    ...fila("Fecha", typeof p.date === "string" ? bogotaDateOnly(p.date) : null),
    ...fila("Hora", p.time),
    ...fila("Duración", typeof p.duration_min === "number" ? `${p.duration_min} min` : null),
    ...fila("Motivo", p.reason),
    ...fila("Notas", p.notes),
    ...fila(
      "Estado",
      typeof p.status === "string"
        ? APPOINTMENT_STATUS[p.status as AppointmentStatus]?.label
        : null,
    ),
  ],

  create_owner: (p) => camposDeTitular(p),
  create_patient: (p) => camposDePaciente(p),

  create_owner_and_patient: (p) => {
    const owner = objeto(p.owner)
    const patient = objeto(p.patient)
    return [
      ...(owner ? camposDeTitular(owner, "Titular") : []),
      ...(patient ? camposDePaciente(patient, "Paciente") : []),
    ]
  },

  update_patient_record: (p) => {
    const alergia = objeto(p.add_allergy)
    return [
      ...peso(p.weight_kg),
      ...fila("Se agrega a las notas", p.notes_append),
      ...fila(
        "Alergia",
        alergia
          ? [
              texto(alergia.allergen),
              typeof alergia.severity === "string" ? SEVERIDAD_ALERGIA[alergia.severity] : null,
              texto(alergia.reaction),
            ]
              .filter(Boolean)
              .join(" · ")
          : null,
      ),
    ]
  },
}

/**
 * Los campos a mostrar para una propuesta. Lista vacía = la tarjeta se pinta como antes, con el
 * resumen solo: un tool nuevo sin descriptor no rompe nada, simplemente no gana la lista.
 */
export function camposDeAccion(toolName: string, payload: unknown): CampoDeAccion[] {
  const p = objeto(payload)
  if (!p) return []
  return POR_TOOL[toolName]?.(p) ?? []
}
