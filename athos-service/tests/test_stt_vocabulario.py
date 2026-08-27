"""El vocabulario veterinario que se le pasa al reconocimiento de voz.

David, 26-ago: *"la transcripción no está tan precisa"*. Al revisar las tres llamadas a STT del
servicio, ninguna reforzaba vocabulario: entraban a una consulta veterinaria colombiana con
`language: "es"` y nada más. Por eso la gramática salía bien y los nombres propios mal.

Lo que este archivo cuida no es la lista —esa cambia— sino las tres formas de romperla en silencio:

1. Pasarse del tope de Deepgram, que responde 400 y deja la consulta SIN TRANSCRIBIR.
2. Mandar el parámetro de la generación equivocada (`keywords` a nova-3 o `keyterm` a nova-2), que
   no da error: se ignora, y el efecto sólo se notaría leyendo transcripts.
3. Colapsar los términos repetidos en un diccionario, que se lleva 99 de los 100.

Las tres pasan desapercibidas sin un test, y las tres dejan al vet exactamente donde estaba.
"""
from urllib.parse import parse_qsl, urlencode

import app.streaming_transcription as st
import app.transcription as tr
import pytest

from app.stt_vocabulario import TERMINOS, TOPE, parametros_de_vocabulario


@pytest.fixture(autouse=True)
def _encendido(monkeypatch):
    """El refuerzo está APAGADO por defecto desde el 27-ago (ver el módulo). Estos tests describen
    cómo se comporta ENCENDIDO, así que lo encienden — el default tiene su propio test abajo."""
    monkeypatch.setenv("STT_VOCABULARIO", "on")


def test_ningun_termino_se_pierde_por_el_tope():
    # Si la lista crece más allá del tope, el recorte es silencioso: los últimos simplemente no
    # viajan. Que este test falle es la señal de que hay que ELEGIR qué sacar, no de subir el tope
    # (100 es el límite de la API, no una preferencia).
    assert len(TERMINOS) <= TOPE


def test_no_hay_terminos_repetidos():
    # Un duplicado no es inocuo: gasta uno de los 100 cupos sin agregar nada.
    assert len(TERMINOS) == len(set(TERMINOS))


def test_nova_2_usa_keywords_con_empuje():
    pares = parametros_de_vocabulario("nova-2")
    assert {k for k, _ in pares} == {"keywords"}
    # El empuje viaja pegado al término, que es como lo espera Deepgram.
    assert all(":" in v for _, v in pares)


def test_nova_3_usa_keyterm_sin_empuje():
    # No son intercambiables y el equivocado NO da error: se ignora en silencio.
    pares = parametros_de_vocabulario("nova-3-general")
    assert {k for k, _ in pares} == {"keyterm"}
    assert all(":" not in v for _, v in pares)


def test_el_modelo_se_lee_tolerante():
    # `STT_MODEL` lo escribe una persona en Railway. Un espacio o una mayúscula no pueden hacer que
    # el vocabulario se mande con el parámetro de la otra generación.
    assert parametros_de_vocabulario("  NOVA-3  ")[0][0] == "keyterm"


def test_el_lote_manda_el_vocabulario_y_no_lo_colapsa(monkeypatch):
    """El camino por lotes: los términos tienen que llegar TODOS, no sólo el último.

    `params` era un dict, y un dict con la misma clave cien veces guarda una.
    """
    monkeypatch.setattr(tr, "_settings_value",
                        lambda campo, env, defecto=None: {"deepgram_api_key": "dg",
                                                          "stt_model": "nova-2"}.get(campo, defecto))
    visto = {}

    class _Resp:
        status_code = 200
        def json(self):
            return {"results": {}}

    class _Cliente:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def post(self, _url, params=None, **k):
            visto["params"] = params
            return _Resp()

    monkeypatch.setattr(tr.httpx, "Client", _Cliente)
    tr._call_deepgram(b"audio")

    params = visto["params"]
    # Lista de pares, no diccionario: es la diferencia entre cien términos y uno.
    assert isinstance(params, list)
    claves = [k for k, _ in params]
    assert claves.count("keywords") == len(TERMINOS)
    # Y lo de siempre sigue estando.
    assert ("language", "es") in params and ("diarize", "true") in params


def test_el_vivo_manda_el_vocabulario_en_la_url(monkeypatch):
    """El streaming arma la URL a mano con `urlencode`, que sobre un dict también colapsaría."""
    monkeypatch.setattr(st, "_settings_value",
                        lambda campo, env, defecto=None: {"stt_model": "nova-2"}.get(campo, defecto))

    model = st._settings_value("stt_model", "STT_MODEL", "nova-2")
    params = [(k, v) for k, v in st.LIVE_PARAMS.items() if k != "model"]
    params.insert(0, ("model", model))
    params += parametros_de_vocabulario(model)

    query = parse_qsl(urlencode(params))
    assert [k for k, _ in query].count("keywords") == len(TERMINOS)
    # `interim_results` es lo que hace que el vivo se distinga del lote: no puede caerse de acá.
    assert ("interim_results", "true") in query
    # Y sigue SIN `encoding` ni `sample_rate`: el navegador manda webm contenerizado y fijarlos
    # devuelve transcripciones vacías (está explicado en `LIVE_PARAMS`).
    assert not any(k in ("encoding", "sample_rate") for k, _ in query)


# ── EL INCIDENTE «PROPOFOL» Y EL REFUERZO POR NOMBRE (26-ago, primera prueba real) ──────────────
#
# El vet dijo «probando, probando» y el transcript arrancó con «Propofol.» — un anestésico
# inventado, casi seguro por el empuje de 1.5 sobre un parónimo. Y «Achira», el nombre de la
# perra, salió «Shira» — el refuerzo global no puede saber nombres, pero el de ESTA consulta sí.


def test_el_empuje_global_es_minimo_desde_el_incidente_propofol():
    # Si alguien vuelve a subirlo, que este test lo obligue a leer el porqué: un fármaco que falta
    # se nota y se corrige; uno inventado en la historia clínica se lee como dicho.
    from app.stt_vocabulario import EMPUJE
    assert EMPUJE == "1"


def test_el_nombre_del_paciente_entra_con_empuje_propio():
    pares = parametros_de_vocabulario("nova-2", nombre_paciente="Achira")
    assert ("keywords", "Achira:3") in pares
    # Y los términos globales siguen en 1.
    assert ("keywords", "meloxicam:1") in pares


def test_el_nombre_va_primero_y_sobrevive_al_tope():
    # Con la lista global en el tope, lo que se recorta es la cola global — nunca el nombre.
    pares = parametros_de_vocabulario("nova-2", nombre_paciente="Achira")
    assert pares[0] == ("keywords", "Achira:3")
    assert len(pares) <= TOPE


def test_nombre_compuesto_entra_por_palabras_en_nova_2():
    # `keywords` de nova-2 no acepta espacios; «de»/«la» no aportan y se filtran.
    pares = parametros_de_vocabulario("nova-2", nombre_paciente="Rocky de la Torre")
    valores = [v for _, v in pares]
    assert "Rocky:3" in valores and "Torre:3" in valores
    assert not any(v.startswith("de:") or v.startswith("la:") for v in valores)


def test_en_nova_3_el_nombre_viaja_entero():
    pares = parametros_de_vocabulario("nova-3", nombre_paciente="Rocky Balboa")
    assert pares[0] == ("keyterm", "Rocky Balboa")


def test_sin_nombre_todo_sigue_igual():
    assert parametros_de_vocabulario("nova-2") == parametros_de_vocabulario("nova-2", None)


def test_apagado_por_defecto_no_manda_una_sola_palabra(monkeypatch):
    """EL DEFAULT, y es la decisión que importa hoy.

    El refuerzo se encendió el 26-ago y la primera prueba real produjo «Propofol» donde el vet dijo
    «probando». Bajar el empuje fue una hipótesis SIN MEDIR, y el cliente está evaluando el Modo
    Fantasma justo ahora: una hipótesis nuestra no puede ser una variable de su prueba.

    Vuelve a encenderse con `STT_VOCABULARIO=on` cuando exista una medición contra audio real.
    """
    monkeypatch.delenv("STT_VOCABULARIO", raising=False)
    assert parametros_de_vocabulario("nova-2", "Achira") == []
    assert parametros_de_vocabulario("nova-3") == []
