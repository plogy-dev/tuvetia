"""Transcripción de la consulta (Modo Fantasma): audio -> Deepgram -> `transcripts`.

Cierra el hueco entre grabar y generar la nota: descarga el audio del bucket privado
`consultation-audios`, lo manda a Deepgram Nova (español + diarización, ADR-0016) y
escribe la fila en `public.transcripts`. Después de esto, `POST /athos/phantom/suggest`
ya tiene transcript del que partir.

`clinic_id` siempre explícito: el microservicio usa service_role y se salta RLS.
"""
import logging
import os
from typing import Any

import httpx
from fastapi import HTTPException
from psycopg.types.json import Json

from app.config import get_settings
from app.db import fetch_all, get_conn
from app.speaker_roles import infer_vet_speaker, label_for
from app.stt_vocabulario import parametros_de_vocabulario

log = logging.getLogger(__name__)

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
AUDIO_BUCKET = "consultation-audios"

# Etiquetas que entiende el parser del front (`parseTranscript` en
# dashboard/consultas/[id]/page.tsx): "Veterinario:" y "Titular:".
#
# Deepgram devuelve índices de hablante (0, 1, ...), no roles. Hasta el 2026-07-29 se asumía que el
# hablante 0 era el veterinario "porque normalmente inicia la consulta" — y es falso: el dueño suele
# abrir ("Doctor, mi perro no come"), así que **el diálogo entero salía invertido** (§4.6a de la
# auditoría). Ahora el rol se infiere del CONTENIDO (`app/speaker_roles.py`, determinístico) y esta
# convención queda sólo como respaldo para cuando no hay señal suficiente.
FALLBACK_SPEAKER_LABELS = {0: "Veterinario", 1: "Titular"}


def _settings_value(name: str, env: str, default: str = "") -> str:
    """Lee de Settings si existe la clave; si no, del entorno. Evita romper si config.py
    todavía no declara la variable."""
    return str(getattr(get_settings(), name, "") or os.environ.get(env, default))


def nombre_del_paciente(clinic_id: str, consultation_id: str) -> str | None:
    """El nombre de la mascota de esta consulta, para reforzarlo en el reconocimiento de voz.

    Es la palabra más repetida del audio y la que peor sale sin ayuda («Achira» → «Shira»,
    26-ago). Falla ABIERTA a propósito: si la consulta no aparece o la base tose, se transcribe
    sin el refuerzo — que es exactamente lo que pasaba antes de que esto existiera. Un nombre de
    menos jamás puede costar una transcripción.
    """
    try:
        rows = fetch_all(
            "select p.name from public.consultations c "
            "join public.patients p on p.id = c.patient_id "
            "where c.clinic_id = %s and c.id = %s limit 1",
            (clinic_id, consultation_id),
        )
        nombre = (rows[0]["name"] or "").strip() if rows else ""
        return nombre or None
    except Exception:  # noqa: BLE001 — ver arriba: el refuerzo nunca puede tumbar el camino
        log.warning("no se pudo leer el nombre del paciente para el refuerzo de STT", exc_info=True)
        return None


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
    # Este endpoint es el primero que baja de Storage por HTTP -> necesita SUPABASE_URL +
    # SUPABASE_SERVICE_ROLE_KEY (chat/phantom no las usan, van directo a Postgres). Si faltan,
    # la URL quedaría sin host y httpx reventaría con un error opaco. Fallar claro y temprano.
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise HTTPException(
            status_code=500,
            detail="faltan SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en el backend "
                   "(requeridas para descargar el audio de Storage en /athos/transcribe)",
        )
    url = f"{settings.supabase_url}/storage/v1/object/{AUDIO_BUCKET}/{storage_path}"
    headers = {"Authorization": f"Bearer {settings.supabase_service_role_key}"}
    with httpx.Client(timeout=120) as client:
        resp = client.get(url, headers=headers)
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"no se pudo descargar el audio ({resp.status_code})")
    return resp.content


XAI_STT_URL = "https://api.x.ai/v1/stt"


def _grok_a_payload_comun(grok: dict[str, Any]) -> dict[str, Any]:
    """Adapta la respuesta de Grok STT a la FORMA de Deepgram que ya habla todo el módulo.

    Grok devuelve {text, language, duration, words:[{text,start,end,speaker?}]}; Deepgram anida en
    results.channels[].alternatives[]. Adaptar acá — y no reescribir build_segments/render_full_text
    y sus tests — mantiene UNA sola ruta de armado de segmentos e inferencia de roles para los dos
    proveedores: lo que está probado sigue probado.
    """
    def _speaker(v) -> int:
        # Coacción defensiva: el formato del campo no está verificado end-to-end (la cuenta aún no
        # tiene créditos). Un "0" como string revienta `s["speaker"] + 1` aguas abajo con un 500
        # DESPUÉS de que el proveedor respondió bien — la transcripción pagada se tiraría.
        try:
            return int(v)
        except (TypeError, ValueError):
            return 0

    words = [
        {
            "word": w.get("text", ""),
            "punctuated_word": w.get("text", ""),
            "start": w.get("start", 0.0),
            "end": w.get("end", 0.0),
            "speaker": _speaker(w.get("speaker", 0)),
        }
        for w in (grok.get("words") or [])
    ]
    return {
        "results": {
            "channels": [{"alternatives": [{"transcript": grok.get("text", ""), "words": words}]}]
        }
    }


def _call_grok(audio: bytes, mime: str = "audio/webm") -> dict[str, Any]:
    """Transcribe con Grok STT (xAI): español, diarización. Devuelve el payload YA adaptado.

    El multipart exige `file` AL FINAL (regla documentada de su API). Sin parámetro de modelo:
    xAI expone un único endpoint /v1/stt.
    """
    api_key = _settings_value("xai_api_key", "XAI_API_KEY")
    if not api_key:
        log.error("falta XAI_API_KEY con STT_PROVIDER=grok: la transcripción no puede correr")
        raise HTTPException(status_code=500, detail="la transcripción no está configurada en el servidor")
    ext = (mime.split("/") + ["webm"])[1].split(";")[0]
    data = {"language": "es", "diarize": "true", "format": "true"}
    files = {"file": (f"audio.{ext}", audio, mime)}  # httpx serializa los campos data antes del file
    headers = {"Authorization": f"Bearer {api_key}"}
    with httpx.Client(timeout=300) as client:
        resp = client.post(XAI_STT_URL, data=data, files=files, headers=headers)
    if resp.status_code != 200:
        # Igual que con Deepgram: el detail llega al toast del vet — el cuerpo crudo, al log.
        log.error("Grok STT respondió %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=502, detail=f"no se pudo transcribir el audio ({resp.status_code})")
    cuerpo = resp.json()
    # Un 200 VACÍO también es un fallo (auditoría 26-ago): sin esto, `{}` o `{"text":""}` pasaba el
    # adaptador, se insertaba un transcript en blanco y la grabación real se perdía EN SILENCIO —
    # exactamente lo que el respaldo a Deepgram existe para impedir. Lanzar acá lo activa.
    if not (cuerpo.get("text") or "").strip() and not cuerpo.get("words"):
        log.error("Grok STT respondió 200 sin contenido: %s", str(cuerpo)[:300])
        raise HTTPException(status_code=502, detail="no se pudo transcribir el audio (respuesta vacía)")
    return _grok_a_payload_comun(cuerpo)


def _transcribir_con_proveedor(
    audio: bytes, mime: str = "audio/webm", nombre_paciente: str | None = None
) -> tuple[dict[str, Any], str, str]:
    """Despacha al proveedor configurado. Devuelve (payload_forma_deepgram, provider, model).

    Con `STT_PROVIDER=grok`, Grok es el primario y Deepgram el RESPALDO automático: una consulta
    grabada no se puede perder porque el proveedor nuevo esté caído o sin créditos — ese es el
    mismo principio de toda cascada de proveedores del servicio. Sin key de Deepgram, el fallo de
    Grok se propaga tal cual (no hay red de seguridad que fingir).
    """
    # .strip(): un "grok " con espacio en Railway caía a Deepgram EN SILENCIO, anulando la
    # migración de costos sin que nadie lo notara (auditoría 26-ago).
    proveedor = _settings_value("stt_provider", "STT_PROVIDER", "deepgram").strip().lower()
    if proveedor == "grok":
        try:
            return _call_grok(audio, mime), "grok", "grok-stt"
        except Exception as e:  # noqa: BLE001 — el respaldo existe justo para el fallo imprevisto
            if not _settings_value("deepgram_api_key", "DEEPGRAM_API_KEY"):
                raise
            log.warning("Grok STT falló (%s); transcribiendo con el respaldo Deepgram", e)
    model = _settings_value("stt_model", "STT_MODEL", "nova-2")
    return _call_deepgram(audio, mime, nombre_paciente), "deepgram", model


def _call_deepgram(
    audio: bytes, mime: str = "audio/webm", nombre_paciente: str | None = None
) -> dict[str, Any]:
    """Transcribe con Deepgram Nova: español, diarización, puntuación."""
    api_key = _settings_value("deepgram_api_key", "DEEPGRAM_API_KEY")
    if not api_key:
        # El `detail` de una HTTPException llega TAL CUAL al toast del vet (`lib/athos.ts` lo
        # superficia a propósito), así que no puede nombrar al proveedor ni a su variable de
        # entorno. Lo que el operador necesita va al log; al vet, qué le pasó y qué hacer.
        log.error("falta DEEPGRAM_API_KEY: la transcripción no puede correr")
        raise HTTPException(status_code=500, detail="la transcripción no está configurada en el servidor")
    model = _settings_value("stt_model", "STT_MODEL", "nova-2")
    # Lista de pares y no diccionario: el vocabulario veterinario repite la misma clave una vez por
    # término (ver `stt_vocabulario.py`), y un dict se quedaría con el último.
    params: list[tuple[str, str]] = [
        ("model", model),
        ("language", "es"),
        ("diarize", "true"),
        ("punctuate", "true"),
        ("smart_format", "true"),
    ]
    params += parametros_de_vocabulario(model, nombre_paciente)
    headers = {"Authorization": f"Token {api_key}", "Content-Type": mime}
    with httpx.Client(timeout=300) as client:
        resp = client.post(DEEPGRAM_URL, params=params, headers=headers, content=audio)
    if resp.status_code != 200:
        # Mismo motivo que arriba, y acá era peor: además del nombre del proveedor se arrastraban
        # 200 caracteres de su cuerpo crudo hasta el navegador del vet.
        log.error("Deepgram respondió %s: %s", resp.status_code, resp.text[:500])
        raise HTTPException(status_code=502, detail=f"no se pudo transcribir el audio ({resp.status_code})")
    return resp.json()


def build_segments(payload: dict[str, Any]) -> list[dict[str, Any]]:
    """Agrupa las palabras de Deepgram en turnos por hablante y les asigna el ROL.

    Devuelve [{speaker, label, role_inferred, start, end, text}]. Función pura -> testeable sin red.

    El rol se infiere del contenido en una segunda pasada, cuando ya está el texto completo de cada
    hablante: un marcador aislado no debe decidir por todo el diálogo.
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
                "start": w.get("start", 0.0),
                "end": w.get("end", 0.0),
                "text": text,
            })
    if not segments:
        return []

    vet, confiable = infer_vet_speaker(segments)
    hablantes = len({s["speaker"] for s in segments})
    for s in segments:
        if confiable:
            s["label"] = label_for(s["speaker"], vet, hablantes)
        else:
            # Sin señal: se conserva la convención anterior, pero marcada como NO inferida para que
            # la UI pueda ofrecer el intercambio manual sabiendo que es una suposición.
            s["label"] = FALLBACK_SPEAKER_LABELS.get(s["speaker"], f"Hablante {s['speaker'] + 1}")
        s["role_inferred"] = confiable
    if not confiable:
        log.info("transcripción: roles NO inferidos (sin marcadores claros); se usó la convención")
    return segments


def render_full_text(segments: list[dict[str, Any]], fallback: str = "") -> str:
    """Texto plano con etiqueta de hablante por línea (lo que renderiza el front)."""
    if not segments:
        return fallback
    return "\n".join(f"{s['label']}: {s['text'].strip()}" for s in segments if s["text"].strip())


def _insert_transcript(clinic_id, consultation_id, audio_id, full_text, segments, model,
                       provider: str = "deepgram") -> str:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into public.transcripts "
            "(clinic_id, consultation_id, audio_id, full_text, segments, stt_provider, stt_model, language) "
            "values (%s,%s,%s,%s,%s,%s,%s,'es') returning id",
            (clinic_id, consultation_id, audio_id, full_text, Json(segments), provider, model),
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
        # El nombre de la mascota entra como refuerzo por consulta — ver `nombre_del_paciente`.
        payload, provider, model = _transcribir_con_proveedor(
            raw, nombre_paciente=nombre_del_paciente(clinic_id, consultation_id)
        )
        segments = build_segments(payload)
        alt = payload.get("results", {}).get("channels", [{}])[0].get("alternatives", [{}])[0]
        full_text = render_full_text(segments, fallback=alt.get("transcript", ""))

        # ── UN TRANSCRIPT VACÍO ES UN FALLO, NO UN ÉXITO SIN PALABRAS ────────────────────────
        #
        # Sin esto se insertaba la fila en blanco y la consulta pasaba igual a `generating_note`,
        # que es un CALLEJÓN SIN SALIDA: la nota se pide sola sólo cuando hay transcripción, así
        # que nadie la generaba nunca, el estado no volvía a moverse y en la pantalla no aparecía
        # ningún error. Quedaba colgada para siempre, en silencio.
        #
        # Medido en producción el 26-ago: 5 de 47 transcripciones reales estaban vacías, con audio
        # de verdad detrás (6 a 26 segundos, hasta 158 KB), y 4 de esas 5 consultas seguían
        # colgadas en `generating_note` — una desde hacía 56 horas.
        #
        # El camino EN VIVO ya hacía lo correcto y está escrito en `streaming_transcription.py`:
        # «silencio total o Deepgram no devolvió nada: que lo resuelva el lote». Las dos rutas se
        # contradecían y la que dejaba consultas muertas era ésta. Al lanzar acá, el `except` de
        # abajo devuelve la consulta a `open`: el audio sigue en el bucket y el vet puede reintentar
        # o escribir la nota a mano, que es lo que no podía hacer estando colgada.
        if not full_text.strip():
            log.error(
                "transcripción vacía con audio real: consulta=%s audio=%s bytes=%s proveedor=%s",
                consultation_id, audio["id"], audio.get("file_size"), provider,
            )
            raise HTTPException(
                status_code=422,
                detail="No se detectó voz en la grabación. Revisá que esté seleccionado el "
                       "micrófono correcto y volvé a grabar.",
            )

        transcript_id = _insert_transcript(
            clinic_id, consultation_id, audio["id"], full_text, segments, model, provider
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
