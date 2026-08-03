/**
 * La traducción de una cita de Tuvetia a la tool de calendario de Composio.
 *
 * Es lo único de `calendario.ts` que se puede probar sin red, y es donde están los detalles que no
 * se adivinan: los nombres de los parámetros y el formato de las fechas salieron de consultar la
 * API (2026-08-03), no de la documentación.
 */
import { describe, expect, it } from "vitest"

import { adaptadorCalendario } from "@/lib/composio/calendario"

const google = adaptadorCalendario("google")

const CITA = {
  titulo: "Control de Pequitas",
  descripcion: "Vacuna anual",
  // Con offset explícito: es lo que devuelve Postgres para un timestamptz.
  inicio: "2026-08-10T09:00:00-05:00",
  fin: "2026-08-10T09:30:00-05:00",
  invitados: ["titular@ejemplo.com", "vet@clinica.co"],
}

describe("crear un evento", () => {
  it("manda la fecha sin zona y la zona aparte, en UTC", () => {
    // La tool pide `YYYY-MM-DDTHH:MM:SS` (sin sufijo) más una zona IANA. Mandar el instante en UTC
    // es lo único que no depende de dónde corra el servidor: 09:00 en Colombia son las 14:00 UTC.
    const { args } = google.crear(CITA)
    expect(args.start_datetime).toBe("2026-08-10T14:00:00")
    expect(args.end_datetime).toBe("2026-08-10T14:30:00")
    expect(args.timezone).toBe("UTC")
  })

  it("usa end_datetime y NO duración", () => {
    // La versión por defecto del toolkit sólo acepta `event_duration_hour`/`_minutes`, con los
    // minutos limitados a 0-59. La versión con fecha que fijamos acepta `end_datetime`, que evita
    // convertir cada cita a horas+minutos y equivocarse en las que cruzan la hora.
    const { args } = google.crear(CITA)
    expect(args).not.toHaveProperty("event_duration_hour")
    expect(args).not.toHaveProperty("event_duration_minutes")
  })

  it("invita al titular y al vet, y pide que les avise", () => {
    const { args } = google.crear(CITA)
    expect(args.attendees).toEqual(["titular@ejemplo.com", "vet@clinica.co"])
    // Sin esto el evento aparece en el calendario del vet y el titular no se entera de nada, que es
    // justamente el punto de empujar la cita.
    expect(args.send_updates).toBe("all")
  })

  it("sin invitados no manda el campo vacío", () => {
    const { args } = google.crear({ ...CITA, invitados: [] })
    expect(args).not.toHaveProperty("attendees")
  })

  it("sin descripción no manda el campo vacío", () => {
    const { args } = google.crear({ ...CITA, descripcion: undefined })
    expect(args).not.toHaveProperty("description")
  })
})

describe("actualizar y borrar", () => {
  it("actualizar manda el mismo evento más su id", () => {
    const { slug, args } = google.actualizar("ev-123", CITA)
    expect(slug).toBe("GOOGLECALENDAR_UPDATE_EVENT")
    expect(args.event_id).toBe("ev-123")
    expect(args.start_datetime).toBe("2026-08-10T14:00:00")
  })

  it("borrar sólo necesita el id", () => {
    const { slug, args } = google.borrar("ev-123")
    expect(slug).toBe("GOOGLECALENDAR_DELETE_EVENT")
    expect(args).toEqual({ calendar_id: "primary", event_id: "ev-123" })
  })
})

describe("leer el id del evento creado", () => {
  it("lo encuentra esté envuelto o no", () => {
    expect(google.idDelEvento({ id: "ev-1" })).toBe("ev-1")
    expect(google.idDelEvento({ response_data: { id: "ev-2" } })).toBe("ev-2")
    expect(google.idDelEvento({ response_data: { event: { id: "ev-3" } } })).toBe("ev-3")
  })

  it("devuelve null si no está, en vez de inventar uno", () => {
    // De esto depende que `empujarCita` falle RUIDOSAMENTE al crear. Guardar null sería peor que
    // el error: la cita quedaría sin referencia al evento y la próxima edición crearía un
    // duplicado en el calendario en vez de actualizar el que ya existe.
    for (const raro of [null, undefined, {}, { response_data: {} }, "texto", { id: 42 }]) {
      expect(google.idDelEvento(raro)).toBeNull()
    }
  })
})
