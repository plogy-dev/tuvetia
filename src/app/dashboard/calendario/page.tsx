import { endOfWeek, startOfWeek } from "date-fns"

import { sesionDelServidor } from "@/lib/supabase/sesion"
import { AppointmentCalendarLazy as AppointmentCalendar } from "@/components/calendar/appointment-calendar-lazy"
import { AvisoConectarCalendario } from "@/components/calendar/aviso-conectar-calendario"
import { calendarioConfigurado, estadoCalendario } from "@/lib/composio/calendario"
import { DataError } from "@/components/data-error"
import { DiaDeHoy, type CitaDeHoy } from "@/components/calendar/dia-de-hoy"
import { huecosDelDia } from "@/lib/agenda/huecos"
import { filtroDeConsulta, puedeVerLaAgendaCompleta } from "@/lib/agenda/filtro"
import { franjasQueMandan, type FranjaDeAlguien } from "@/lib/agenda/horario-de-cada-quien"
import { bogotaTodayISO } from "@/lib/date-utils"
import { localWeekday } from "@/lib/athos-agent/agenda"
import { APPOINTMENT_SELECT, type AppointmentRow, type PatientOption, type SelectOption } from "@/lib/appointments"

export const metadata = { title: "Agenda · Tuvetia" }


/** Los estados que ocupan un espacio de verdad. Una cancelada o un no-show lo liberan. */
const ESTADOS_VIVOS = new Set(["scheduled", "confirmed", "in_progress"])

// La agenda de la clínica. `public.appointments` es la ÚNICA fuente de verdad: nada entra desde un
// calendario externo (calendario v3, migración 0049 — la sincronización es de una sola vía). Eso es
// lo que cierra el incidente del 2026-07-31, cuando el pull automático metió el calendario personal
// de un vet como citas de la clínica: hoy ese canal no existe.
//
// Conectar un calendario se hace desde /dashboard/conexiones, no acá: es una decisión de cada
// usuario (su propio calendario), no algo de la pantalla de agenda.

export default async function CalendarioPage() {
  const { supabase, user } = await sesionDelServidor()

  // Rango inicial: semana actual (lun–dom). El cliente refetchea al navegar.
  const now = new Date()
  const rangeStart = startOfWeek(now, { weekStartsOn: 1 })
  const rangeEnd = endOfWeek(now, { weekStartsOn: 1 })


  // clinic_id explícito para el selector de vets (defensa en profundidad, no solo RLS).
  //
  // `role` y `ve_agenda_completa` viajan en la MISMA consulta que ya se hacía: ver la agenda de
  // toda la clínica pasó a ser un permiso otorgable (0070), y quién mira decide qué citas se piden.
  const perfil = user
    ? ((await supabase
        .from("profiles")
        .select("clinic_id, role, ve_agenda_completa")
        .eq("id", user.id)
        .single()
      ).data as { clinic_id: string | null; role: string | null; ve_agenda_completa: boolean | null } | null)
    : null
  const clinicId = perfil?.clinic_id ?? null
  const veTodo = puedeVerLaAgendaCompleta(perfil)
  const acotarA = filtroDeConsulta(perfil, user?.id ?? null)

  const [
    { data: appts, error: apptsError },
    { data: pts },
    { data: owns },
    { data: profs },
    { data: avisos },
    miCalendario,
  ] = await Promise.all([
      // EL PERMISO SE APLICA ACÁ, en la consulta, y no en el navegador. Antes la pantalla se
      // traía las citas de la clínica entera y el interruptor las tapaba del lado del cliente: o
      // sea que las citas de los demás viajaban igual en la página, y "mi agenda" era una vista,
      // no un límite. Sin este filtro, el permiso sería un cartel.
      (acotarA
        ? supabase.from("appointments").select(APPOINTMENT_SELECT).or(acotarA)
        : supabase.from("appointments").select(APPOINTMENT_SELECT)
      )
        .lte("starts_at", rangeEnd.toISOString())
        .gte("ends_at", rangeStart.toISOString())
        .order("starts_at", { ascending: true }),
      // Guarda de escala: opciones de los selects del drawer acotadas (búsqueda tipada: backlog).
      // owner_id viaja para el autocompletado/bloqueo titular↔paciente del drawer.
      supabase.from("patients").select("id, name, owner_id").order("name").limit(1000),
      supabase.from("owners").select("id, full_name").order("full_name").limit(1000),
      clinicId
        ? supabase.from("profiles").select("id, full_name").eq("clinic_id", clinicId)
        : Promise.resolve({ data: null }),
      // Si la clínica tiene encendidos los avisos de cita. El panel lateral lo DICE —no lo cambia—
      // y va en esta misma ola: encadenarla después le sumaría su latencia a la carga de la agenda.
      clinicId
        ? supabase
            .from("clinics")
            .select("confirmacion_citas_activo, recordatorio_citas_activo")
            .eq("id", clinicId)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      // ¿ESTA PERSONA tiene calendario conectado? (v5) Desde que el evento se crea en el calendario
      // del veterinario asignado, la pregunta dejó de ser sobre el administrador y pasó a ser sobre
      // quien mira. Va DENTRO del `Promise.all` a propósito: es una consulta a Composio por red, y
      // encadenarla después de las citas le sumaría su latencia entera a la carga de la agenda.
      user && calendarioConfigurado()
        ? estadoCalendario(user.id)
        : Promise.resolve({ conectado: false, proveedor: null, compartidoConElCorreo: false }),
    ])

  const patients: PatientOption[] = (
    (pts as { id: string; name: string; owner_id: string | null }[] | null) ?? []
  ).map((p) => ({ id: p.id, label: p.name, ownerId: p.owner_id }))
  const owners: SelectOption[] = ((owns as { id: string; full_name: string }[] | null) ?? []).map((o) => ({
    id: o.id,
    label: o.full_name,
  }))
  const vets: SelectOption[] = (
    (profs as { id: string; full_name: string | null }[] | null) ?? []
  ).map((v) => ({ id: v.id, label: v.full_name ?? "—" }))

  // El día de hoy como lista, encima de la grilla. Se arma con las citas QUE YA SE TRAJERON —la
  // semana incluye hoy— así que no cuesta ninguna consulta extra; sólo los horarios de atención,
  // que son cinco filas.
  const hoy = bogotaTodayISO()
  // LA SEMANA ENTERA, NO SÓLO HOY. Antes esta consulta filtraba por el día de hoy porque su único
  // consumidor era «Hoy». Ahora también decide QUÉ HORAS DIBUJA LA GRILLA (`rangoVisible`), y la
  // vista de semana muestra siete días: si el sábado abre más temprano, esa fila tiene que existir.
  // Son siete filas en vez de una, así que sigue siendo una consulta que no se nota.
  const { data: franjasDeLaSemana } = clinicId
    ? await supabase
        .from("clinic_hours")
        .select("weekday, opens_at, closes_at, vet_id")
        .eq("clinic_id", clinicId)
        // La de la clínica y la de quien está mirando (0069): esta lista es SU día, no el de la
        // puerta. Cuál manda lo decide `franjasQueMandan`, no el filtro.
        .or(user ? `vet_id.is.null,vet_id.eq.${user.id}` : "vet_id.is.null")
    : { data: null }

  const todasLasFranjas = (franjasDeLaSemana as (FranjaDeAlguien & { weekday: number })[] | null) ?? []
  // El filtro por día que antes hacía Postgres. «Hoy» sigue necesitando sólo el día de hoy.
  const franjasHoy = todasLasFranjas.filter((f) => f.weekday === localWeekday(hoy))

  const citasDeHoy: CitaDeHoy[] = ((appts as unknown as AppointmentRow[] | null) ?? [])
    .filter((a) => a.starts_at.slice(0, 10) === hoy && ESTADOS_VIVOS.has(a.status))
    .map((a) => ({
      id: a.id,
      starts_at: a.starts_at,
      etiqueta: [a.patient?.name, a.title].filter(Boolean).join(" · ") || "Cita",
      estado: a.status,
    }))

  const huecos = huecosDelDia({
    date: hoy,
    // EL HORARIO DE QUIEN MIRA, no el de la clínica. Un vet que entra a las 2 veía "libre de 8 a
    // 14" como si le sobrara media jornada, porque la clínica abre a las 8.
    franjas: franjasQueMandan(
      (franjasHoy as FranjaDeAlguien[] | null) ?? [],
      user?.id ?? null,
    ),
    // Los huecos se calculan contra TODAS las citas vivas del día, no sólo las que se listan:
    // una cita cancelada libera el espacio, una confirmada no.
    ocupados: ((appts as unknown as AppointmentRow[] | null) ?? [])
      .filter((a) => a.starts_at.slice(0, 10) === hoy && ESTADOS_VIVOS.has(a.status))
      .map((a) => ({ starts_at: a.starts_at, ends_at: a.ends_at })),
  })

  return (
    // El alto SE HEREDA, y desde el 27-ago es cierto: el shell mide el viewport (`ui/sidebar.tsx`,
    // `h-svh`) y el scroll vive en el área de contenido, así que este `flex-1 min-h-0` reparte
    // espacio de verdad. Acá hubo un `lg:h-[calc(...)]` un día — el parche que sostuvo esta
    // pantalla mientras la raíz seguía en `min-h-svh`. Se retira con la raíz arreglada.
    <div className="flex flex-col gap-4 p-[clamp(16px,3vw,32px)] lg:min-h-0 lg:flex-1">
      {/* SIN <h1> ACÁ, y es a propósito. Le puse uno `sr-only` en el PR #98 dando por hecho que la
          pantalla se quedaba sin encabezado, porque `page.tsx` no tenía ninguno. Medido después en
          producción: sí lo tiene — `AppointmentCalendar` renderiza <h1>Calendario</h1>. Con el mío
          quedaban DOS, que es el defecto que ese PR venía a arreglar.

          Es el mismo punto ciego que sí atrapé en `asistente` (su <h1> vive en `assistant.tsx`, no
          en su `page.tsx`) y que acá se me pasó: contar encabezados leyendo sólo el archivo de la
          página no alcanza cuando el título lo pone un componente hijo. */}
      {apptsError && (
        <DataError>
          No se pudieron cargar las citas; el calendario puede verse vacío. Recargá la página.
        </DataError>
      )}
      {/* Se le pide el calendario a quien no lo tiene, ACÁ, que es donde se nota que falta. Hasta v4
          la única señal era un toast después de guardar una cita: tarde, y con la solución en otra
          pantalla. Se cierra, y "Ahora no" la calla por el resto del día. */}
      <AvisoConectarCalendario conectado={miCalendario.conectado} esAdmin={perfil?.role === "admin"} />
      <DiaDeHoy citas={citasDeHoy} huecos={huecos} />
      <AppointmentCalendar
        initialAppointments={(appts as unknown as AppointmentRow[] | null) ?? []}
        initialRange={{ start: rangeStart.toISOString(), end: rangeEnd.toISOString() }}
        patients={patients}
        owners={owners}
        vets={vets}
        miId={user?.id ?? null}
        veTodo={veTodo}
        acotarA={acotarA}
        /* Las de TODA la semana y sin pasar por `franjasQueMandan`: la grilla es una sola para los
           siete días, así que lo que corresponde es la unión —la apertura más temprana y el cierre
           más tardío— y no elegir entre el horario de la clínica y el propio. Elegir achicaría el
           rango, y hacia ese lado es donde se esconden citas. */
        franjas={todasLasFranjas}
        avisosActivos={Boolean(
          (avisos as { confirmacion_citas_activo?: boolean; recordatorio_citas_activo?: boolean } | null)
            ?.confirmacion_citas_activo ||
            (avisos as { recordatorio_citas_activo?: boolean } | null)?.recordatorio_citas_activo,
        )}
      />
    </div>
  )
}
