"""STT con Groq/Whisper (con Q — Groq Inc.) y su respaldo a Deepgram.

Fija los invariantes del proveedor (aclarado 2026-08-27: el cliente quería Groq, no Grok/xAI):
- El adaptador NO inventa hablantes: Whisper no diariza, así que el payload va sin words y el
  transcript cae a texto plano — jamás un diálogo entero rotulado "Veterinario:".
- Con STT_PROVIDER=groq (o el alias de transición "grok"), un fallo de Groq cae SOLO a Deepgram;
  sin key de Deepgram el fallo se propaga sin fingir red.
- Un 200 vacío es un fallo (activa el respaldo): sin esto se insertaba un transcript en blanco y
  la grabación real se perdía en silencio (auditoría 26-ago).
- El proveedor que respondió DE VERDAD es el que se persiste.
"""
import pytest
from fastapi import HTTPException

import app.transcription as tr


def test_adaptador_sin_hablantes_cae_a_texto_plano():
    payload = tr._groq_a_payload_comun({"text": "  Doctor, mi perro no come desde ayer.  "})
    alt = payload["results"]["channels"][0]["alternatives"][0]
    assert alt["transcript"] == "Doctor, mi perro no come desde ayer."
    assert alt["words"] == []                      # sin hablantes inventados
    assert tr.build_segments(payload) == []        # -> render_full_text usa el fallback plano


def _config(monkeypatch, valores: dict):
    monkeypatch.setattr(tr, "_settings_value",
                        lambda name, env, default="": valores.get(name, default))


def test_groq_primario_responde_y_se_persiste_como_groq(monkeypatch):
    _config(monkeypatch, {"stt_provider": "groq", "groq_api_key": "gsk-x", "deepgram_api_key": "dg"})
    monkeypatch.setattr(tr, "_call_groq",
                        lambda audio, mime="audio/webm": tr._groq_a_payload_comun({"text": "hola"}))
    payload, provider, model = tr._transcribir_con_proveedor(b"audio")
    assert provider == "groq" and model == tr.GROQ_STT_MODEL_DEFAULT
    assert payload["results"]["channels"]


def test_alias_grok_de_transicion_tambien_despacha_a_groq(monkeypatch):
    """Railway decía STT_PROVIDER=grok durante la confusión del 26-27-ago: un deploy a mitad de
    camino no debe apagar el cambio en silencio."""
    _config(monkeypatch, {"stt_provider": "grok", "groq_api_key": "gsk-x", "deepgram_api_key": "dg"})
    monkeypatch.setattr(tr, "_call_groq",
                        lambda audio, mime="audio/webm": tr._groq_a_payload_comun({"text": "hola"}))
    _, provider, _ = tr._transcribir_con_proveedor(b"audio")
    assert provider == "groq"


def test_groq_caido_cae_a_deepgram(monkeypatch):
    _config(monkeypatch, {"stt_provider": "groq", "groq_api_key": "gsk-x",
                          "deepgram_api_key": "dg", "stt_model": "nova-2"})

    def revienta(*a, **k):
        raise HTTPException(status_code=502, detail="proveedor caído")

    llamado = {}
    monkeypatch.setattr(tr, "_call_groq", revienta)
    monkeypatch.setattr(tr, "_call_deepgram",
                        lambda audio, mime="audio/webm", nombre_paciente=None:
                        llamado.setdefault("dg", True) or {"results": {}})
    _, provider, model = tr._transcribir_con_proveedor(b"audio")
    assert llamado.get("dg") and provider == "deepgram" and model == "nova-2"


def test_groq_caido_sin_deepgram_propaga(monkeypatch):
    _config(monkeypatch, {"stt_provider": "groq", "groq_api_key": "gsk-x", "deepgram_api_key": ""})

    def revienta(*a, **k):
        raise HTTPException(status_code=502, detail="proveedor caído")

    monkeypatch.setattr(tr, "_call_groq", revienta)
    with pytest.raises(HTTPException):
        tr._transcribir_con_proveedor(b"audio")


def test_groq_200_vacio_dispara_el_respaldo(monkeypatch):
    _config(monkeypatch, {"stt_provider": "groq", "groq_api_key": "gsk-x",
                          "deepgram_api_key": "dg", "stt_model": "nova-2"})

    class _Resp:
        status_code = 200
        text = "{}"
        def json(self):
            return {"text": "   "}

    class _Cliente:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, *a, **k): return _Resp()

    monkeypatch.setattr(tr.httpx, "Client", _Cliente)
    llamado = {}
    monkeypatch.setattr(tr, "_call_deepgram",
                        lambda audio, mime="audio/webm", nombre_paciente=None:
                        llamado.setdefault("dg", True) or {"results": {}})
    _, provider, _ = tr._transcribir_con_proveedor(b"audio")
    assert llamado.get("dg") and provider == "deepgram"


def test_proveedor_por_defecto_sigue_siendo_deepgram(monkeypatch):
    _config(monkeypatch, {"deepgram_api_key": "dg", "stt_model": "nova-2"})
    monkeypatch.setattr(tr, "_call_deepgram",
                        lambda audio, mime="audio/webm", nombre_paciente=None: {"results": {}})
    _, provider, _ = tr._transcribir_con_proveedor(b"audio")
    assert provider == "deepgram"
