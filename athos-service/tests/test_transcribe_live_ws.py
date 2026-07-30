"""El WebSocket /athos/transcribe/live, de punta a punta, con un Deepgram falso.

Prueba el PROTOCOLO: init -> ready -> audio -> texto -> stop -> finalize -> saved, y que cada modo
de fallo termine en `fallback:true` (que es lo que hace que el veterinario no pierda la consulta).
"""
import json

import pytest
from fastapi.testclient import TestClient

import app.streaming_transcription as st
from app.main import app


# --------------------------------------------------------------------------- dobles de prueba

class FakeDeepgram:
    """Socket de Deepgram falso: guarda lo que recibe y emite los mensajes que se le programen."""

    def __init__(self, salida=()):
        self.enviado_bytes = b""
        self.control = []
        self._salida = list(salida)
        self.cerrado = False

    async def send(self, dato):
        if isinstance(dato, bytes):
            self.enviado_bytes += dato
        else:
            self.control.append(json.loads(dato))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        self.cerrado = True
        return False

    def __aiter__(self):
        async def gen():
            for m in self._salida:
                yield json.dumps(m)
        return gen()


def _resultado(texto, palabras, is_final=True):
    return {
        "type": "Results",
        "is_final": is_final,
        "channel": {"alternatives": [{"transcript": texto, "words": palabras}]},
    }


def _p(word, start, speaker=0):
    return {"word": word, "punctuated_word": word, "start": start, "end": start + 0.3,
            "speaker": speaker}


CONVERSACION = [
    _resultado("Doctor", [_p("Doctor", 0.1, 0)], is_final=False),
    _resultado("Doctor mi perro no come",
               [_p("Doctor", 0.1, 0), _p("mi", 0.4, 0), _p("perro", 0.7, 0),
                _p("no", 1.0, 0), _p("come", 1.3, 0)]),
    _resultado("Vamos a palpar su perro",
               [_p("Vamos", 2.0, 1), _p("a", 2.2, 1), _p("palpar", 2.4, 1),
                _p("su", 2.7, 1), _p("perro", 3.0, 1)]),
]


@pytest.fixture
def escenario(monkeypatch):
    """Aísla el WS de red y base de datos; devuelve lo que se persistió."""
    dg = FakeDeepgram(CONVERSACION)
    guardado = {}

    async def _abrir():
        return dg

    monkeypatch.setattr(st, "abrir_deepgram", _abrir)
    monkeypatch.setattr(st, "_set_consultation_status", lambda *a, **k: None)
    monkeypatch.setattr(st, "_settings_value", lambda *a, **k: "nova-2")

    def _insert(clinic_id, consultation_id, audio_id, full_text, segments, model):
        guardado.update(clinic_id=clinic_id, consultation_id=consultation_id,
                        audio_id=audio_id, full_text=full_text, segments=segments, model=model)
        return "t-123"

    monkeypatch.setattr(st, "_insert_transcript", _insert)
    monkeypatch.setattr("app.main._auth_token", lambda token, clinic: ("u-1", "c-1"))
    return dg, guardado


INIT = {"type": "init", "token": "jwt", "clinic_id": "c-1", "consultation_id": "cons-1"}


# --------------------------------------------------------------------------- camino feliz

def test_ciclo_completo_hasta_guardar(escenario):
    dg, guardado = escenario
    with TestClient(app).websocket_connect("/athos/transcribe/live") as ws:
        ws.send_text(json.dumps(INIT))
        assert ws.receive_json() == {"type": "ready"}

        ws.send_bytes(b"\x1a\x45\xdf\xa3audio-webm")

        # El interino llega como provisional y NO como texto confirmado.
        primero = ws.receive_json()
        assert primero["type"] == "text"
        assert primero["final"] is False
        assert primero["provisional"] == "Doctor"

        # Los dos tramos finales, ya con rol inferido.
        segundo = ws.receive_json()
        assert segundo["final"] is True
        tercero = ws.receive_json()
        assert tercero["final"] is True
        assert "Titular: Doctor mi perro no come" in tercero["estable"]
        assert "Veterinario: Vamos a palpar su perro" in tercero["estable"]

        ws.send_text(json.dumps({"type": "stop"}))
        parada = ws.receive_json()
        assert parada["type"] == "stopped"
        assert parada["palabras"] == 10

        # El audio ya se subió: recién ahora se puede persistir (FK de audio_id).
        ws.send_text(json.dumps({"type": "finalize", "audio_id": "aud-9"}))
        final = ws.receive_json()
        assert final["type"] == "saved"
        assert final["transcript_id"] == "t-123"

    assert dg.enviado_bytes == b"\x1a\x45\xdf\xa3audio-webm"
    assert {"type": "CloseStream"} in dg.control
    assert guardado["audio_id"] == "aud-9"
    assert guardado["clinic_id"] == "c-1"
    assert guardado["full_text"].startswith("Titular:")


def test_el_audio_llega_intacto_a_deepgram(escenario):
    """Los chunks se reenvían tal cual y en orden: si se tocan, Deepgram no decodifica el webm."""
    dg, _ = escenario
    with TestClient(app).websocket_connect("/athos/transcribe/live") as ws:
        ws.send_text(json.dumps(INIT))
        ws.receive_json()
        for trozo in (b"uno", b"dos", b"tres"):
            ws.send_bytes(trozo)
        ws.send_text(json.dumps({"type": "stop"}))
    assert dg.enviado_bytes == b"unodostres"


def test_los_roles_no_se_invierten(escenario):
    """El defecto §4.6a: el dueño abre la consulta, así que el hablante 0 NO es el veterinario."""
    _dg, guardado = escenario
    with TestClient(app).websocket_connect("/athos/transcribe/live") as ws:
        ws.send_text(json.dumps(INIT))
        ws.receive_json()
        ws.send_text(json.dumps({"type": "stop"}))
        ws.receive_json()  # stopped (los Results ya se drenaron)
        ws.send_text(json.dumps({"type": "finalize", "audio_id": "aud-9"}))
        ws.receive_json()
    etiquetas = [s["label"] for s in guardado["segments"]]
    assert etiquetas == ["Titular", "Veterinario"]


# --------------------------------------------------------------------------- degradación

def test_si_deepgram_no_conecta_manda_fallback(monkeypatch):
    """Sin Deepgram el veterinario NO puede quedarse sin transcripción: cae al lote."""
    async def _explota():
        raise RuntimeError("falta DEEPGRAM_API_KEY")

    monkeypatch.setattr(st, "abrir_deepgram", _explota)
    monkeypatch.setattr(st, "_set_consultation_status", lambda *a, **k: None)
    monkeypatch.setattr("app.main._auth_token", lambda token, clinic: ("u-1", "c-1"))

    with TestClient(app).websocket_connect("/athos/transcribe/live") as ws:
        ws.send_text(json.dumps(INIT))
        msg = ws.receive_json()
    assert msg["type"] == "error"
    assert msg["fallback"] is True
    assert "DEEPGRAM_API_KEY" in msg["detalle"]


def test_token_invalido_no_abre_sesion(monkeypatch):
    def _rechaza(token, clinic):
        raise ValueError("token inválido")

    llamadas = []
    monkeypatch.setattr("app.main._auth_token", _rechaza)
    monkeypatch.setattr(st, "abrir_deepgram", lambda: llamadas.append(1))

    with TestClient(app).websocket_connect("/athos/transcribe/live") as ws:
        ws.send_text(json.dumps(INIT))
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["fallback"] is True
    assert llamadas == [], "no se debe abrir Deepgram sin autenticar"


def test_primer_mensaje_que_no_es_init_se_rechaza(monkeypatch):
    monkeypatch.setattr("app.main._auth_token", lambda t, c: ("u-1", "c-1"))
    with TestClient(app).websocket_connect("/athos/transcribe/live") as ws:
        ws.send_text(json.dumps({"type": "audio"}))
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["fallback"] is True


def test_sesion_muda_cae_al_lote(monkeypatch):
    """Silencio total: no hay nada que guardar y el lote debe encargarse."""
    async def _abrir():
        return FakeDeepgram([])          # Deepgram no devuelve ni un Results

    monkeypatch.setattr(st, "abrir_deepgram", _abrir)
    monkeypatch.setattr(st, "_set_consultation_status", lambda *a, **k: None)
    monkeypatch.setattr("app.main._auth_token", lambda t, c: ("u-1", "c-1"))

    with TestClient(app).websocket_connect("/athos/transcribe/live") as ws:
        ws.send_text(json.dumps(INIT))
        ws.receive_json()  # ready
        ws.send_text(json.dumps({"type": "stop"}))
        assert ws.receive_json()["type"] == "stopped"
        msg = ws.receive_json()
    assert msg["type"] == "error" and msg["fallback"] is True
