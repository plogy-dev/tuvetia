"""Transcripción de la consulta (Modo Fantasma): audio -> Deepgram -> `transcripts`.

Cierra el hueco entre grabar y generar la nota: descarga el audio del bucket privado
`consultation-audios`, lo manda a Deepgram Nova (español + diarización, ADR-0016) y
escribe la fila en `public.transcripts`. Después de esto, `POST /athos/phantom/suggest`
ya tiene transcript del que partir.

`clinic_id` siempre explícito: el microservicio usa service_role y se salta RLS.
"""
import os
from typing import Any

import httpx
from fastapi import HTTPException
from psycopg.types.json import Json

from app.config import get_settings
from app.db import fetch_all, get_conn

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
AUDIO_BUCKET = "consultation-audios"

# Etiquetas que entiende el parser del front (`parseTranscript` en
# dashboard/consultas/[id]/page.tsx): "Veterinario:" y "Titular:".
# HEURÍSTICA: Deepgram devuelve índices de hablante (0,1,...), no roles. Asumimos que
# el hablante 0 es el veterinario (normalmente inicia la consulta). Los segmentos crudos
# quedan en `transcripts.segments`, así que si la UI luego permite intercambiar roles,
# el dato original no se pierde.
SPEAKER_LABELS = {0: "Veterinario", 1: "Titular"}


def _settings_value(name: str, env: str, default: str = "") -> str:
    """Lee de Settings si existe la clave; si no, del entorno. Evita romper si config.py
    todavía no declara la variable."""
    return str(getattr(get_settings(), name, "") or os.environ.get(env, default))


def _load_audio_row(clinic_id: str, consultation_id: str) -> dict | None:
    rows = fetch_all(
        "select id, storage_path, duration_secs from public.consultation_audios "
        "where clinic_id = %s and consultation_id = %s and storage_path is not null "
        "order by created_at desc limit 1",
        (clinic_id, consultation_id),
    )
    return rows[0] if rows else None


def _download_audio(storage_path: str) -> bytes:
    """Baja el objeto del bucket privado con service_role."""
    settings = get_settings()
    url = f"{settings.supabase_url}/storage/v1/object/{AUDIO_BUCKET}/{storage_path}"
    headers = {"Authorization": f"Bearer {settings.supabase_service_role_key}"}
    with httpx.Client(timeout=120) as client:
        resp = client.get(url, headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"no se pudo descargar el audio ({resp.status_code})")
    return resp.content


def _call_deepgram(audio: bytes, mime: str = "audio/webm") -> dict[str, Any]:
    """Transcribe con Deepgram Nova: español, diarización, puntuación."""
    api_key = _settings_value("deepgram_api_key", "DEEPGRAM_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="falta DEEPGRAM_API_KEY")
    model = _settings_value("stt_model", "STT_MODEL", "nova-2")
    params = {
        "model": model,
        "language": "es",
        "diarize": "true",
        "punctuate": "true",
        "smart_format": "true",
    }
    headers = {"Authorization": f"Token {api_key}", "Content-Type": mime}
    with httpx.Client(timeout=300) as client:
        resp = client.post(DEEPGRAM_URL, params=params, headers=headers, content=audio)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Deepgram respondió {resp.status_code}: {resp.text[:200]}")
    return resp.json()


def build_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Agrupa las palabras de Deepgram en turnos por hablante.

    Devuelve [{speaker, label, start, end, text}]. Función pura -> testeable sin red.
    """
    try:
        alt = payload["results"]["channels"][0]["alternatives"][0]
    except (KeyError, IndexError):
        return []
    words = alt.get("words") or []
    segments: list[dict[str, Any]] = []
    for w in words:
        speaker = w.get("speaker", 0)
        text = w.get("punctuated_word") or w.get("word", "")
        if segments and segments[-1]["speaker"] == speaker:
            segments[-1]["text"] += f" {text}"
            segments[-1]["end"] = w.get("end", segments[-1]["end"])
        else:
            segments.append({
                "speaker": speaker,
                "label": SPEAKER_LABELS.get(speaker, f"Hablante {speaker + 1}"),
                "start": w.get("start", 0.0),
                "end": w.get("end", 0.0),
                "text": text,
            })
    return segments


def render_full_text(segments: list[dict[str, Any]], fallback: str = "") -> str:
    """Texto plano con etiqueta de hablante por línea (lo que renderiza el front)."""
    if not segments:
        return fallback
    return "\n".join(f"{s['label']}: {s['text'].strip()}" for s in segments if s["text"].strip())


def _insert_transcript(clinic_id, consultation_id, audio_id, full_text, segments, model) -> str:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into public.transcripts "
            "(clinic_id, consultation_id, audio_id, full_text, segments, stt_provider, stt_model, language) "
            "values (%s,%s,%s,%s,%s,'deepgram',%s,'es') returning id",
            (clinic_id, consultation_id, audio_id, full_text, Json(segments), model),
        )
        transcript_id = cur.fetchone()["id"]
        conn.commit()
    return str(transcript_id)


def _set_consultation_status(clinic_id: str, consultation_id: str, status: str) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "update public.consultations set status = %s, updated_at = now() "
            "where clinic_id = %s and id = %s",
            (status, clinic_id, consultation_id),
        )
        conn.commit()


def transcribe(consultation_id: str, clinic_id: str) -> dict[str, Any]:
    """Transcribe el último audio de la consulta y guarda el transcript.

    Devuelve {transcript_id, full_text, segments, stt_model}.
    """
    audio = _load_audio_row(clinic_id, consultation_id)
    if not audio:
        raise HTTPException(status_code=404, detail="la consulta no tiene audio disponible")

    _set_consultation_status(clinic_id, consultation_id, "transcribing")
    try:
        raw = _download_audio(audio["storage_path"])
        payload = _call_deepgram(raw)
        segments = build_segments(payload)
        alt = payload.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0]
        full_text = render_full_text(segments, fallback=alt.get("transcript", ""))
        model = _settings_value("stt_model", "STT_MODEL", "nova-2")
        transcript_id = _insert_transcript(
            clinic_id, consultation_id, audio["id"], full_text, segments, model
        )
    except Exception:
        _set_consultation_status(clinic_id, consultation_id, "open")
        raise

    _set_consultation_status(clinic_id, consultation_id, "generating_note")
    return {
        "transcript_id": transcript_id,
        "full_text": full_text,
        "segments": segments,
        "stt_model": model,
    }
