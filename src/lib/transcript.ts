// Parseo de transcripciones a turnos de diálogo (Vet / Titular). Puro y compartido entre la
// pantalla de revisión de consulta y la historia clínica del paciente.
//
// El backend (transcription.py) emite líneas "Veterinario: …" / "Titular: …". Aceptamos también
// variantes que puedan venir de datos sembrados o edición manual (dueño, propietario, médico, etc.).

export type Turn = { who: "vet" | "owner"; text: string }

export function parseTranscript(text: string): Turn[] {
  if (!text) return []
  const turns: Turn[] = []
  for (const raw of text.split(/\n+/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(
      /^(veterinari[oa]|vet|m[ée]dic[oa]|due[nñ][oa]|due[nñ]a|propietari[oa]|cliente|titular)\s*:\s*(.*)$/i,
    )
    if (m) {
      turns.push({ who: /vet|m[ée]dic/i.test(m[1]) ? "vet" : "owner", text: m[2] })
    } else {
      turns.push({ who: "owner", text: line })
    }
  }
  return turns
}
