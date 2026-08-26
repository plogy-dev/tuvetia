"""STT con Grok (xAI) y su respaldo a Deepgram (`_transcribir_con_proveedor`).

Fija los invariantes del cambio de proveedor (2026-08-26), sin red:
- El adaptador de Grok produce la MISMA forma que Deepgram: build_segments/render_full_text (y la
  inferencia de roles) siguen siendo una sola ruta probada para ambos proveedores.
- Con STT_PROVEEDOR=grok, un fallo de Grok cae SOLO a Deepgram (una consulta no se pierde por un
  proveedor caído o sin créditos) — y sin key de Deepgram, el fallo se propaga sin fingir red.
- El proveedor que respondió DE VERDAD es el que se persiste.
"""
import pytest
from fastapi import HTTPException

import app.transcription as tr


GROK = {
    "text": "Titular: Doctor, mi perro no come. Veterinario: ¿Desde cuándo?",
    "language": "es",
    "duration": 4.2,
    "words": [
        {"text": "Doctor,", "start": 0.1, "end": 0.5, "speaker": 0},
        {"text": "mi", "start": 0.5, "end": 0.6, "speaker": 0},
        {"text": "perro", "start": 0.6, "end": 0.9, "speaker": 0},
        {"text": "¿Desde", "start": 1.5, "end": 1.9, "speaker": 1},
        {"text": "cuándo?", "start": 1.9, "end": 2.3, "speaker": 1},
    ],
}


def test_adaptador_produce_la_forma_de_deepgram():
    payload = tr._grok_a_payload_comun(GROK)
    alt = payload["results"]["channels"][0]["alternatives"][0]
    assert alt["transcript"].startswith("Titular: Doctor")
    assert alt["words"][0]["punctuated_word"] == "Doctor,"
    assert alt["words"][3]["speaker"] == 1
    # y build_segments lo consume tal cual (agrupa por hablante)
    segs = tr.build_segments(payload)
    assert [s["speaker"] for s in segs] == [0, 1]
    assert "mi perro" in segs[0]["text"]


def _config(monkeypatch, valores: dict):
    monkeypatch.setattr(tr, "_settings_value",
                        lambda name, env, default="": valores.get(name, default))


def test_grok_primario_responde_y_se_persiste_como_grok(monkeypatch):
    _config(monkeypatch, {"stt_provider": "grok", "xai_api_key": "xai-x", "deepgram_api_key": "dg"})
    monkeypatch.setattr(tr, "_call_grok", lambda audio, mime="audio/webm": tr._grok_a_payload_comun(GROK))
    payload, provider, model = tr._transcribir_con_proveedor(b"audio")
    assert provider == "grok" and model == "grok-stt"
    assert payload["results"]["channels"]


def test_grok_caido_cae_a_deepgram(monkeypatch):
    _config(monkeypatch, {"stt_provider": "grok", "xai_api_key": "xai-x",
                          "deepgram_api_key": "dg", "stt_model": "nova-2"})

    def revienta(*a, **k):
        raise HTTPException(status_code=502, detail="sin créditos")

    llamado = {}
    monkeypatch.setattr(tr, "_call_grok", revienta)
    monkeypatch.setattr(tr, "_call_deepgram",
                        lambda audio, mime="audio/webm": llamado.setdefault("dg", True) or {"results": {}})
    payload, provider, model = tr._transcribir_con_proveedor(b"audio")
    assert llamado.get("dg") and provider == "deepgram" and model == "nova-2"


def test_grok_caido_sin_deepgram_propaga(monkeypatch):
    _config(monkeypatch, {"stt_provider": "grok", "xai_api_key": "xai-x", "deepgram_api_key": ""})

    def revienta(*a, **k):
        raise HTTPException(status_code=502, detail="sin créditos")

    monkeypatch.setattr(tr, "_call_grok", revienta)
    with pytest.raises(HTTPException):
        tr._transcribir_con_proveedor(b"audio")


def test_proveedor_por_defecto_sigue_siendo_deepgram(monkeypatch):
    _config(monkeypatch, {"deepgram_api_key": "dg", "stt_model": "nova-2"})
    monkeypatch.setattr(tr, "_call_deepgram", lambda audio, mime="audio/webm": {"results": {}})
    _, provider, _ = tr._transcribir_con_proveedor(b"audio")
    assert provider == "deepgram"
