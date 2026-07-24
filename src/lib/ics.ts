// Generador iCalendar (RFC 5545) para el feed de solo lectura del calendario. Puro: sin red.
// Lo consume el endpoint /api/calendar/ics/[token].

export type IcsAppointment = {
  id: string
  title: string
  reason: string | null
  notes: string | null
  starts_at: string
  ends_at: string
  status: string
  patient: { name: string } | null
}

// Escapa según RFC 5545 (orden importa: barra primero).
function esc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n")
}

// ISO -> UTC básico YYYYMMDDTHHMMSSZ.
function icsDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
}

// Plegado de líneas a <=75 octetos (continuación con un espacio inicial), como pide el RFC.
function fold(line: string): string {
  if (line.length <= 75) return line
  const out: string[] = []
  let idx = 0
  while (idx < line.length) {
    out.push((idx === 0 ? "" : " ") + line.slice(idx, idx + (idx === 0 ? 75 : 74)))
    idx += idx === 0 ? 75 : 74
  }
  return out.join("\r\n")
}

// STATUS de iCalendar solo admite TENTATIVE | CONFIRMED | CANCELLED.
function icsStatus(status: string): string {
  if (status === "canceled") return "CANCELLED"
  if (status === "confirmed" || status === "in_progress" || status === "completed") return "CONFIRMED"
  return "TENTATIVE"
}

export function buildIcs(
  appts: IcsAppointment[],
  opts: { calName?: string; now?: Date } = {},
): string {
  const calName = opts.calName ?? "TuvetIA — Agenda"
  const dtstamp = (opts.now ?? new Date()).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//TuvetIA//Calendario//ES",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${esc(calName)}`),
    fold(`NAME:${esc(calName)}`),
  ]

  for (const a of appts) {
    const who = a.patient?.name ? `${a.patient.name} — ` : ""
    const summary = `${who}${a.title}`
    const description = [a.reason, a.notes].filter(Boolean).join("\n\n")
    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:${a.id}@tuvetia`),
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${icsDate(a.starts_at)}`,
      `DTEND:${icsDate(a.ends_at)}`,
      fold(`SUMMARY:${esc(summary)}`),
    )
    if (description) lines.push(fold(`DESCRIPTION:${esc(description)}`))
    lines.push(`STATUS:${icsStatus(a.status)}`, "END:VEVENT")
  }

  lines.push("END:VCALENDAR")
  return lines.join("\r\n") + "\r\n"
}
