"use client"

// Reproductor del audio de una consulta. El bucket `consultation-audios` es PRIVADO, así que no hay
// URL pública: pedimos una signed URL temporal con la sesión del usuario (RLS de Storage exige que
// el primer segmento de la ruta == clinic_id del usuario, o sea, solo el audio de su propia clínica).
// Se carga de forma perezosa al pulsar "Reproducir" para no firmar decenas de URLs al abrir la historia.

import { useState } from "react"
import { Loader2, Play } from "lucide-react"
import { toast } from "sonner"

import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"

const AUDIO_BUCKET = "consultation-audios"
const SIGNED_URL_TTL = 60 * 60 // 1 h

function fmtDuration(secs?: number | null): string | null {
  if (!secs || secs <= 0) return null
  return `${String(Math.floor(secs / 60)).padStart(2, "0")}:${String(secs % 60).padStart(2, "0")}`
}

export function ConsultationAudioPlayer({
  storagePath,
  durationSecs,
}: {
  storagePath: string
  durationSecs?: number | null
}) {
  const [supabase] = useState(() => createClient())
  const [url, setUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function loadAudio() {
    setLoading(true)
    const { data, error } = await supabase.storage
      .from(AUDIO_BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL)
    setLoading(false)
    if (error || !data?.signedUrl) {
      toast.error(`No se pudo cargar el audio: ${error?.message ?? "URL no disponible"}`)
      return
    }
    setUrl(data.signedUrl)
  }

  const label = fmtDuration(durationSecs)

  if (url) {
    return <audio controls autoPlay src={url} className="h-9 w-full max-w-md" />
  }

  return (
    <Button size="sm" variant="outline" onClick={loadAudio} disabled={loading}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
      Reproducir audio{label ? ` · ${label}` : ""}
    </Button>
  )
}
