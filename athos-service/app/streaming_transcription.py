"""Transcripción EN VIVO (Modo Fantasma): Deepgram Live -> texto incremental -> `transcripts`.

Complementa `app/transcription.py` (por lotes), no lo reemplaza: el audio se sigue subiendo al
bucket y el camino por lotes queda de **red de seguridad**. Si la sesión en vivo se cae a mitad de
consulta, el veterinario no pierde nada — se transcribe al cerrar, como hasta ahora.

**La decisión de diseño que hace esto testeable:** los mensajes del streaming se acumulan en la
**misma forma** que devuelve la API por lotes (`results.channels[0].alternatives[0].words`). Así
`build_segments`, la inferencia de roles y el renderizado son **el mismo código** en los dos caminos.
No hay una segunda implementación de "quién habló" que se pueda desincronizar de la primera, y todo
esto se prueba con mensajes fixture, sin red.

Referencia del protocolo: cada mensaje `Results` trae `is_final`. Los **interinos** (`is_final:
false`) son hipótesis que Deepgram **reemplaza** después; sirven para pintar en pantalla y hay que
descartarlos al construir el transcript definitivo. Acumularlos es el bug clásico del streaming: el
texto sale duplicado y con frases a medias.

El **protocolo** con el navegador (ver `run_live_session`) está dictado por una restricción del
esquema: `transcripts.audio_id` tiene FK a `consultation_audios`, así que el transcript **no se puede
guardar antes de que el audio esté subido**. Por eso el cierre es en dos tiempos — `stop` (deja de
llegar audio, Deepgram vacía lo pendiente) y `finalize` (ya existe la fila del audio, se persiste).
"""
from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlencode

from app.stt_vocabulario import parametros_de_vocabulario
from app.transcription import (
    _insert_transcript,
    _set_consultation_status,
    _settings_value,
    build_segments,
    render_full_text,
)

log = logging.getLogger(__name__)

# Parámetros de la conexión con Deepgram Live. `interim_results` es lo que permite pintar texto
# mientras el veterinario habla; sin eso el "en vivo" no se distingue del lote.
LIVE_PARAMS = {
    "model": "nova-2",
    "language": "es",
    "diarize": "true",
    "punctuate": "true",
    "smart_format": "true",
    "interim_results": "true",
    # ⚠️ A propósito **sin** `encoding` ni `sample_rate`. El navegador manda webm/opus
    # *contenerizado* (`MediaRecorder`), y Deepgram deduce el formato de la cabecera del contenedor.
    # Fijar `encoding` le dice que son muestras crudas: interpreta la cabecera como audio y la
    # transcripción sale vacía o en ruido. Sólo se declaran esos dos si algún día se manda PCM.
    #
    # Deepgram cierra la conexión tras ~10 s sin audio: los silencios de la consulta (el vet
    # ausculta, el dueño busca un papel) se cubren con `keepalive_message()`.
}

DEEPGRAM_LIVE_URL = "wss://api.deepgram.com/v1/listen"


def keepalive_message() -> dict[str, str]:
    """Mensaje que mantiene viva la conexión durante los silencios de la consulta."""
    return {"type": "KeepAlive"}


def close_message() -> dict[str, str]:
    """Le pide a Deepgram que cierre y devuelva lo que le quede pendiente."""
    return {"type": "CloseStream"}


@dataclass
class LiveUpdate:
    """Lo que hay que mandarle al navegador tras cada mensaje de Deepgram."""

    texto_estable: str          # todo lo confirmado hasta ahora
    texto_provisional: str      # la hipótesis en curso, se reemplaza sola
    es_final: bool


@dataclass
class DeepgramLiveSession:
    """Acumula los mensajes de Deepgram Live y produce el transcript final.

    Puro: no toca red ni base de datos. Se le dan mensajes ya deserializados y devuelve qué mostrar.
    """

    _palabras: list[dict[str, Any]] = field(default_factory=list)
    _provisional: str = ""
    # Marca de tiempo de la última palabra confirmada. Deepgram puede **reenviar** un tramo ya
    # finalizado (pasa al reconectar y con `endpointing`): sin esta guarda, esas palabras entran dos
    # veces y el transcript sale con frases repetidas.
    _fin_confirmado: float = -1.0
    _mensajes_ignorados: int = 0

    # ---------- entrada ----------

    def add_message(self, msg: dict[str, Any]) -> LiveUpdate | None:
        """Procesa un mensaje del socket. Devuelve None si no cambia nada que mostrar."""
        if msg.get("type") and msg.get("type") != "Results":
            # Metadata / SpeechStarted / UtteranceEnd: útiles para depurar, no cambian el texto.
            return None

        palabras = self._palabras_de(msg)
        transcripcion = self._transcripcion_de(msg)
        if not palabras and not transcripcion.strip():
            return None  # silencio: Deepgram manda tramos vacíos y no hay que pintarlos

        if not msg.get("is_final"):
            self._provisional = transcripcion
            return LiveUpdate(self.texto_estable, transcripcion, False)

        nuevas = [w for w in palabras if float(w.get("start", 0.0)) > self._fin_confirmado]
        if not nuevas:
            # Tramo ya contabilizado (reenvío). Se ignora, pero se cuenta: si esto crece mucho hay
            # un problema de reconexión que conviene ver en los logs.
            self._mensajes_ignorados += 1
            self._provisional = ""
            return None

        self._palabras.extend(nuevas)
        self._fin_confirmado = max(float(w.get("start", 0.0)) for w in nuevas)
        self._provisional = ""
        return LiveUpdate(self.texto_estable, "", True)

    # ---------- salida ----------

    @property
    def texto_estable(self) -> str:
        """Texto confirmado, ya con etiqueta de hablante. Es lo que se persiste si todo va bien."""
        return render_full_text(self.segments)

    @property
    def segments(self) -> list[dict[str, Any]]:
        """Turnos por hablante con su rol, por el MISMO código que el camino por lotes."""
        return build_segments(self.to_batch_payload())

    @property
    def tiene_contenido(self) -> bool:
        """¿La sesión sirve para persistir? Si no, quien llame debe caer al lote."""
        return bool(self._palabras)

    def to_batch_payload(self) -> dict[str, Any]:
        """Devuelve lo acumulado con la forma EXACTA de la respuesta por lotes.

        Es el puente que evita duplicar la lógica de diarización y roles.
        """
        return {
            "results": {
                "channels": [
                    {
                        "alternatives": [
                            {
                                "transcript": " ".join(
                                    w.get("punctuated_word") or w.get("word", "")
                                    for w in self._palabras
                                ),
                                "words": self._palabras,
                            }
                        ]
                    }
                ]
            }
        }

    def diagnostico(self) -> dict[str, Any]:
        """Para el log al cerrar: permite ver si hubo reenvíos sin instrumentar el navegador."""
        return {
            "palabras": len(self._palabras),
            "mensajes_ignorados": self._mensajes_ignorados,
            "segundos": round(self._fin_confirmado, 1) if self._fin_confirmado > 0 else 0.0,
        }

    # ---------- helpers ----------

    @staticmethod
    def _alternativa(msg: dict[str, Any]) -> dict[str, Any]:
        try:
            return msg["channel"]["alternatives"][0]
        except (KeyError, IndexError, TypeError):
            return {}

    @classmethod
    def _palabras_de(cls, msg: dict[str, Any]) -> list[dict[str, Any]]:
        return cls._alternativa(msg).get("words") or []

    @classmethod
    def _transcripcion_de(cls, msg: dict[str, Any]) -> str:
        return cls._alternativa(msg).get("transcript") or ""


# --------------------------------------------------------------------------------------------
# Conexión con Deepgram
# --------------------------------------------------------------------------------------------

async def abrir_deepgram():
    """Abre el socket con Deepgram Live. Función aparte para poder sustituirla en las pruebas."""
    from websockets.asyncio.client import connect

    api_key = _settings_value("deepgram_api_key", "DEEPGRAM_API_KEY")
    if not api_key:
        raise RuntimeError("falta DEEPGRAM_API_KEY")
    model = _settings_value("stt_model", "STT_MODEL", "nova-2")
    # `urlencode` sobre una LISTA de pares, no sobre el dict: el vocabulario veterinario repite la
    # misma clave una vez por término y un dict conservaría sólo el último.
    params = [(k, v) for k, v in LIVE_PARAMS.items() if k != "model"]
    params.insert(0, ("model", model))
    params += parametros_de_vocabulario(model)
    url = f"{DEEPGRAM_LIVE_URL}?{urlencode(params)}"
    return await connect(url, additional_headers={"Authorization": f"Token {api_key}"})


def persist_live_transcript(
    clinic_id: str, consultation_id: str, audio_id: str | None, sesion: DeepgramLiveSession
) -> dict[str, Any]:
    """Guarda el transcript producido en vivo. Mismo destino y forma que el camino por lotes."""
    segments = sesion.segments
    full_text = render_full_text(segments)
    model = _settings_value("stt_model", "STT_MODEL", "nova-2")
    transcript_id = _insert_transcript(
        clinic_id, consultation_id, audio_id, full_text, segments, model
    )
    _set_consultation_status(clinic_id, consultation_id, "generating_note")
    log.info("transcripción en vivo guardada: %s %s", transcript_id, sesion.diagnostico())
    return {
        "transcript_id": transcript_id,
        "full_text": full_text,
        "segments": segments,
        "stt_model": model,
    }


# --------------------------------------------------------------------------------------------
# Protocolo con el navegador
# --------------------------------------------------------------------------------------------
#
#   navegador                          servidor                       Deepgram
#   ---------                          --------                       --------
#   {type:"init", token, ...}   ---->  verifica JWT + membresía
#                               <----  {type:"ready"}                 (socket abierto)
#   <bytes de audio>            ---->                          ---->  audio
#                               <----  {type:"text", ...}      <----  Results
#   {type:"stop"}               ---->                          ---->  CloseStream
#                               <----  {type:"stopped", texto} <----  últimos Results
#   (sube el audio al bucket)
#   {type:"finalize", audio_id} ---->  persiste el transcript
#                               <----  {type:"saved", transcript_id}
#
# Cualquier fallo -> {type:"error", fallback:true} y el navegador transcribe por lotes.

KEEPALIVE_SEGUNDOS = 5.0


async def _bombear_a_deepgram(ws: Any, dg: Any, estado: dict[str, Any]) -> None:
    """Navegador -> Deepgram. Termina cuando llega `stop` o se corta la conexión."""
    while True:
        msg = await ws.receive()
        if msg.get("type") == "websocket.disconnect":
            estado["desconectado"] = True
            return
        if (datos := msg.get("bytes")) is not None:
            estado["bytes"] += len(datos)
            await dg.send(datos)
            continue
        texto = msg.get("text")
        if not texto:
            continue
        control = json.loads(texto)
        if control.get("type") == "stop":
            await dg.send(json.dumps(close_message()))
            return
        if control.get("type") == "finalize":
            estado["audio_id"] = control.get("audio_id")
            estado["finalizar"] = True
            return


async def _bombear_desde_deepgram(ws: Any, dg: Any, sesion: DeepgramLiveSession) -> None:
    """Deepgram -> navegador. Cada mensaje se acumula y se reenvía ya renderizado."""
    async for crudo in dg:
        try:
            msg = json.loads(crudo)
        except (TypeError, ValueError):
            continue
        upd = sesion.add_message(msg)
        if upd is None:
            continue
        await ws.send_json({
            "type": "text",
            "estable": upd.texto_estable,
            "provisional": upd.texto_provisional,
            "final": upd.es_final,
        })


async def _keepalive(dg: Any) -> None:
    """Evita que Deepgram cierre por los silencios propios de una consulta."""
    while True:
        await asyncio.sleep(KEEPALIVE_SEGUNDOS)
        await dg.send(json.dumps(keepalive_message()))


async def run_live_session(ws: Any, autenticar) -> None:
    """Orquesta la sesión completa. `autenticar(token, clinic_id) -> (user_id, clinic_id)`.

    Nunca deja la consulta a medias: ante cualquier fallo avisa con `fallback:true` para que el
    navegador transcriba por lotes, que es el camino que ya estaba probado en producción.
    """
    await ws.accept()
    sesion = DeepgramLiveSession()
    estado: dict[str, Any] = {"bytes": 0, "audio_id": None, "finalizar": False, "desconectado": False}

    try:
        init = json.loads((await ws.receive()).get("text") or "{}")
        if init.get("type") != "init":
            raise ValueError("el primer mensaje debe ser init")
        # El token viaja en el cuerpo, NO en la query string: las URLs quedan en los logs de acceso
        # del proxy y un JWT ahí es una credencial filtrada.
        _user_id, clinic_id = autenticar(init.get("token") or "", init.get("clinic_id") or "")
        consultation_id = init["consultation_id"]
    except Exception as e:  # noqa: BLE001
        await _avisar_error(ws, f"no se pudo iniciar la sesión: {e}")
        await ws.close()
        return

    try:
        dg = await abrir_deepgram()
    except Exception as e:  # noqa: BLE001
        log.warning("transcripción en vivo no disponible: %s", e)
        await _avisar_error(ws, f"no se pudo conectar con Deepgram: {e}")
        await ws.close()
        return

    _set_consultation_status(clinic_id, consultation_id, "transcribing")
    await ws.send_json({"type": "ready"})

    try:
        async with dg:
            vivo = asyncio.create_task(_keepalive(dg))
            recepcion = asyncio.create_task(_bombear_desde_deepgram(ws, dg, sesion))
            try:
                await _bombear_a_deepgram(ws, dg, estado)
                # Deepgram sigue mandando los últimos tramos tras el CloseStream: hay que drenarlos
                # o se pierde el final de la consulta, que es donde está el plan.
                await asyncio.wait_for(recepcion, timeout=15)
            finally:
                vivo.cancel()
                recepcion.cancel()

        if estado["desconectado"]:
            _set_consultation_status(clinic_id, consultation_id, "open")
            return

        await ws.send_json({"type": "stopped", "estable": sesion.texto_estable,
                            "palabras": sesion.diagnostico()["palabras"]})

        if not sesion.tiene_contenido:
            # Silencio total o Deepgram no devolvió nada: que lo resuelva el lote.
            await _avisar_error(ws, "la sesión en vivo no capturó texto")
            _set_consultation_status(clinic_id, consultation_id, "open")
            await ws.close()
            return

        # Espera el `finalize`, que sólo llega cuando el audio ya está subido (FK de audio_id).
        if not estado["finalizar"]:
            control = json.loads((await asyncio.wait_for(ws.receive(), timeout=120)).get("text") or "{}")
            if control.get("type") != "finalize":
                raise ValueError("se esperaba finalize")
            estado["audio_id"] = control.get("audio_id")

        resultado = persist_live_transcript(clinic_id, consultation_id, estado["audio_id"], sesion)
        await ws.send_json({
            "type": "saved",
            "transcript_id": resultado["transcript_id"],
            "full_text": resultado["full_text"],
        })
    except Exception as e:  # noqa: BLE001
        log.exception("sesión de transcripción en vivo fallida")
        _set_consultation_status(clinic_id, consultation_id, "open")
        await _avisar_error(ws, str(e))
    finally:
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass


async def _avisar_error(ws: Any, detalle: str) -> None:
    """Un error del vivo NUNCA es fatal: le dice al navegador que caiga al lote."""
    try:
        await ws.send_json({"type": "error", "detalle": detalle, "fallback": True})
    except Exception:  # noqa: BLE001
        pass
