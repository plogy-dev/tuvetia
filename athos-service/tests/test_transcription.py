"""Tests de transcripción: agrupación por hablante y render del texto.

No tocan red: `build_segments` y `render_full_text` son funciones puras sobre el
payload de Deepgram. Lo que importa clínicamente es que la diarización se conserve
(quién dijo qué -> Subjetivo vs Objetivo en la nota SOAP).
"""
from app.transcription import build_segments, render_full_text


def _payload(words):
    return {"results": {"channels": [{"alternatives": [{"transcript": "x", "words": words}]}]}}


def test_agrupa_palabras_consecutivas_por_hablante():
    payload = _payload([
        {"speaker": 0, "punctuated_word": "Hola,", "start": 0.0, "end": 0.4},
        {"speaker": 0, "punctuated_word": "cuénteme.", "start": 0.4, "end": 1.0},
        {"speaker": 1, "punctuated_word": "Luna", "start": 1.2, "end": 1.6},
        {"speaker": 1, "punctuated_word": "vomitó.", "start": 1.6, "end": 2.1},
        {"speaker": 0, "punctuated_word": "¿Desde", "start": 2.3, "end": 2.6},
        {"speaker": 0, "punctuated_word": "cuándo?", "start": 2.6, "end": 3.0},
    ])
    segs = build_segments(payload)
    assert [s["speaker"] for s in segs] == [0, 1, 0], "debe crear un turno por cambio de hablante"
    assert segs[0]["text"] == "Hola, cuénteme."
    assert segs[1]["text"] == "Luna vomitó."
    assert segs[0]["end"] == 1.0, "el fin del turno es el de su última palabra"


def test_etiqueta_hablantes_para_el_front():
    payload = _payload([
        {"speaker": 0, "punctuated_word": "Hola.", "start": 0.0, "end": 0.3},
        {"speaker": 1, "punctuated_word": "Buenas.", "start": 0.5, "end": 0.9},
    ])
    segs = build_segments(payload)
    assert segs[0]["label"] == "Veterinario"
    assert segs[1]["label"] == "Titular"
    # El front (parseTranscript) espera "Etiqueta: texto" por línea.
    texto = render_full_text(segs)
    assert texto == "Veterinario: Hola.\nTitular: Buenas."


def test_sin_palabras_usa_el_fallback():
    assert build_segments(_payload([])) == []
    assert render_full_text([], fallback="texto plano") == "texto plano"


def test_payload_malformado_no_revienta():
    assert build_segments({"results": {}}) == []
