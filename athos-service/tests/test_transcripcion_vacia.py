"""Una transcripción vacía es un FALLO, no un éxito sin palabras.

Medido en producción el 26-ago: 5 de 47 transcripciones reales estaban vacías, con audio de verdad
detrás (6 a 26 segundos, hasta 158 KB), y 4 de esas 5 consultas seguían colgadas en
`generating_note` — una desde hacía 56 horas, sin un solo error en pantalla.

POR QUÉ ERA UN CALLEJÓN SIN SALIDA. El camino por lotes trataba «cero palabras» como éxito:
insertaba la fila en blanco y avanzaba el estado a `generating_note`. Pero la nota se pide sola
sólo cuando HAY transcripción, así que nadie la generaba nunca y el estado no volvía a moverse. La
consulta quedaba muerta, en silencio, y el vet no tenía ni el error ni la nota ni forma de
reintentar.

Y las dos rutas se contradecían: el camino EN VIVO ya hacía lo correcto —«silencio total o Deepgram
no devolvió nada: que lo resuelva el lote»— y el de lotes, que era el último recurso, era el que
mataba la consulta.
"""
import pytest
from fastapi import HTTPException

import app.transcription as tr


def _sin_red(monkeypatch, payload):
    """Deja `transcribe()` sin base ni red: audio falso, descarga falsa, proveedor falso."""
    estados = []
    monkeypatch.setattr(tr, "_load_audio_row",
                        lambda c, k: {"id": "aud-1", "storage_path": "p/x.webm", "file_size": 158656})
    monkeypatch.setattr(tr, "_download_audio", lambda ruta: b"audio")
    monkeypatch.setattr(tr, "_transcribir_con_proveedor",
                        lambda raw, mime="audio/webm", **kw: (payload, "deepgram", "nova-2"))
    # El refuerzo del nombre no puede tocar la base en un test: se anula explícito.
    monkeypatch.setattr(tr, "nombre_del_paciente", lambda clinic, consulta: None)
    monkeypatch.setattr(tr, "_set_consultation_status",
                        lambda clinic, consulta, estado: estados.append(estado))
    monkeypatch.setattr(tr, "_insert_transcript",
                        lambda *a, **k: estados.append("INSERTÓ") or "t-1")
    return estados


def _payload(texto):
    return {"results": {"channels": [{"alternatives": [{"transcript": texto, "words": []}]}]}}


def test_transcripcion_vacia_no_se_guarda_y_devuelve_la_consulta_a_open(monkeypatch):
    estados = _sin_red(monkeypatch, _payload("   "))
    with pytest.raises(HTTPException) as e:
        tr.transcribe("consulta-1", "clinica-1")

    # No se inserta la fila en blanco: es la fila que hacía que la nota no se pidiera nunca.
    assert "INSERTÓ" not in estados
    # Y la consulta vuelve a `open`, que es de donde el vet puede reintentar o escribir a mano.
    assert estados[-1] == "open"
    assert "generating_note" not in estados
    # El detalle llega TAL CUAL al toast del vet: tiene que decirle qué hacer, y no nombrar al
    # proveedor ni a su variable de entorno.
    assert "micrófono" in e.value.detail.lower()
    assert "deepgram" not in e.value.detail.lower()


def test_con_texto_de_verdad_sigue_guardando_y_avanza(monkeypatch):
    estados = _sin_red(monkeypatch, _payload("Vengo porque la perra está vomitando."))
    salida = tr.transcribe("consulta-1", "clinica-1")
    assert "INSERTÓ" in estados
    assert estados[-1] == "generating_note"
    assert salida["full_text"].startswith("Vengo porque")
