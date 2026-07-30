"""La sesión de streaming: que lo que se muestra en vivo y lo que se guarda coincidan.

Todo sin red: se le dan mensajes con la forma real de Deepgram Live y se mira qué acumula.
"""
from app.streaming_transcription import DeepgramLiveSession


def _palabra(word, start, speaker=0, punt=None):
    return {
        "word": word,
        "punctuated_word": punt or word,
        "start": start,
        "end": start + 0.3,
        "confidence": 0.99,
        "speaker": speaker,
    }


def _msg(palabras, is_final, transcript=None):
    """Mensaje `Results` de Deepgram Live."""
    texto = transcript if transcript is not None else " ".join(
        p.get("punctuated_word") or p["word"] for p in palabras
    )
    return {
        "type": "Results",
        "is_final": is_final,
        "channel": {"alternatives": [{"transcript": texto, "words": palabras}]},
    }


# ---------- lo esencial: interinos vs finales ----------

def test_los_interinos_no_se_acumulan():
    """El bug clásico del streaming: si se acumulan los interinos, el texto sale duplicado.

    Deepgram manda hipótesis parciales que REEMPLAZA después. Acá se ve el ciclo completo:
    tres interinos que van creciendo y un final que los sustituye a todos.
    """
    s = DeepgramLiveSession()
    s.add_message(_msg([_palabra("Doctor", 0.1)], is_final=False))
    s.add_message(_msg([_palabra("Doctor", 0.1), _palabra("mi", 0.5)], is_final=False))
    s.add_message(_msg([_palabra("Doctor", 0.1), _palabra("mi", 0.5), _palabra("perro", 0.8)],
                       is_final=False))
    assert s.tiene_contenido is False           # nada confirmado todavía

    s.add_message(_msg([_palabra("Doctor", 0.1), _palabra("mi", 0.5), _palabra("perro", 0.8)],
                       is_final=True))
    assert s.texto_estable.count("Doctor") == 1
    assert "Doctor mi perro" in s.texto_estable


def test_el_interino_se_devuelve_como_provisional():
    s = DeepgramLiveSession()
    upd = s.add_message(_msg([_palabra("Doctor", 0.1)], is_final=False))
    assert upd is not None
    assert upd.es_final is False
    assert upd.texto_provisional == "Doctor"
    assert upd.texto_estable == ""              # aún no hay nada confirmado


def test_el_final_limpia_el_provisional():
    s = DeepgramLiveSession()
    s.add_message(_msg([_palabra("Doctor", 0.1)], is_final=False))
    upd = s.add_message(_msg([_palabra("Doctor", 0.1)], is_final=True))
    assert upd.es_final is True
    assert upd.texto_provisional == ""
    assert "Doctor" in upd.texto_estable


# ---------- reenvíos y reconexión ----------

def test_un_tramo_final_reenviado_no_entra_dos_veces():
    """Deepgram reenvía tramos ya finalizados al reconectar. Sin la guarda, el texto se repite."""
    s = DeepgramLiveSession()
    tramo = [_palabra("no", 1.0), _palabra("come", 1.4)]
    s.add_message(_msg(tramo, is_final=True))
    s.add_message(_msg(tramo, is_final=True))          # el mismo, otra vez
    assert s.texto_estable.count("come") == 1
    assert s.diagnostico()["mensajes_ignorados"] == 1


def test_un_reenvio_parcial_solo_agrega_lo_nuevo():
    """Reenvía el tramo anterior MÁS palabras nuevas: sólo deben entrar las nuevas."""
    s = DeepgramLiveSession()
    s.add_message(_msg([_palabra("no", 1.0), _palabra("come", 1.4)], is_final=True))
    s.add_message(_msg(
        [_palabra("no", 1.0), _palabra("come", 1.4), _palabra("nada", 1.9)], is_final=True))
    assert s.texto_estable.count("come") == 1
    assert "nada" in s.texto_estable


# ---------- mensajes que no son texto ----------

def test_ignora_los_mensajes_de_control():
    s = DeepgramLiveSession()
    for tipo in ("Metadata", "SpeechStarted", "UtteranceEnd"):
        assert s.add_message({"type": tipo}) is None
    assert s.tiene_contenido is False


def test_el_silencio_no_pinta_nada():
    """Deepgram manda tramos vacíos en los silencios; no deben llegar a la pantalla."""
    s = DeepgramLiveSession()
    assert s.add_message(_msg([], is_final=False, transcript="")) is None
    assert s.add_message(_msg([], is_final=True, transcript="")) is None


def test_mensaje_deforme_no_revienta():
    s = DeepgramLiveSession()
    assert s.add_message({"type": "Results", "is_final": True}) is None
    assert s.add_message({"type": "Results", "channel": {}}) is None
    assert s.tiene_contenido is False


# ---------- el puente con el camino por lotes ----------

def test_los_roles_salen_igual_que_por_lotes():
    """Lo que más importa: en vivo y por lotes deben etiquetar al vet en el MISMO hablante.

    Se reproduce el caso de la auditoría (§4.6a): el DUEÑO abre la consulta, así que el hablante 0
    es el titular. Si el streaming tuviera su propia lógica, acá saldría invertido.
    """
    s = DeepgramLiveSession()
    s.add_message(_msg([
        _palabra("Doctor", 0.1, speaker=0),
        _palabra("mi", 0.4, speaker=0),
        _palabra("perro", 0.7, speaker=0),
        _palabra("no", 1.0, speaker=0),
        _palabra("come", 1.3, speaker=0),
    ], is_final=True))
    s.add_message(_msg([
        _palabra("Vamos", 2.0, speaker=1),
        _palabra("a", 2.2, speaker=1),
        _palabra("palpar", 2.4, speaker=1),
        _palabra("su", 2.7, speaker=1),
        _palabra("perro", 3.0, speaker=1),
    ], is_final=True))

    segs = s.segments
    assert len(segs) == 2
    assert segs[0]["label"] == "Titular"          # habló primero y NO es el veterinario
    assert segs[1]["label"] == "Veterinario"
    assert all(sg["role_inferred"] for sg in segs)
    assert s.texto_estable.startswith("Titular:")


def test_el_payload_tiene_la_forma_del_lote():
    """`to_batch_payload` es el contrato con build_segments: si cambia, esto lo caza."""
    s = DeepgramLiveSession()
    s.add_message(_msg([_palabra("hola", 0.1)], is_final=True))
    payload = s.to_batch_payload()
    alt = payload["results"]["channels"][0]["alternatives"][0]
    assert alt["words"][0]["word"] == "hola"
    assert alt["transcript"] == "hola"


def test_sin_contenido_no_se_persiste():
    """La señal que usa el WS para decidir si cae al camino por lotes."""
    s = DeepgramLiveSession()
    s.add_message(_msg([_palabra("mmm", 0.1)], is_final=False))
    assert s.tiene_contenido is False
    s.add_message(_msg([_palabra("mmm", 0.1)], is_final=True))
    assert s.tiene_contenido is True


def test_el_diagnostico_reporta_lo_acumulado():
    s = DeepgramLiveSession()
    s.add_message(_msg([_palabra("uno", 0.1), _palabra("dos", 5.0)], is_final=True))
    d = s.diagnostico()
    assert d["palabras"] == 2
    assert d["segundos"] == 5.0
