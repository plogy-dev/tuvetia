"""Documentos del chat -> memoria del paciente (`index_chat_document`).

Fija los invariantes de la función, sin DB ni Cohere (todo mockeado):
- AISLAMIENTO: no escribe si el paciente no pertenece a la clínica (regla 6/7 del servicio).
- IDEMPOTENCIA: el source_id es determinístico por contenido — el mismo documento adjuntado dos
  veces produce el MISMO source_id (el UNIQUE de la 0074 + on conflict hacen el resto en la base).
- BEST-EFFORT: sin Cohere devuelve False y no inserta (la memoria es mejora, no requisito).
"""
import app.patient_memory as pm
from app.embeddings import EmbeddingError


class _Cliente:
    def __init__(self, *a, **k):
        pass

    def embed(self, textos, input_type=None):
        return [[0.1] * 4 for _ in textos]


def _capturar(monkeypatch, *, paciente_existe=True):
    llamadas = {"inserts": []}
    monkeypatch.setattr(pm, "fetch_all", lambda sql, params: [{"?column?": 1}] if paciente_existe else [])
    monkeypatch.setattr(pm, "execute", lambda sql, params: llamadas["inserts"].append(params))
    monkeypatch.setattr(pm, "EmbeddingClient", _Cliente)
    return llamadas


def test_indexa_con_source_id_deterministico(monkeypatch):
    llamadas = _capturar(monkeypatch)
    ok1 = pm.index_chat_document("cl-1", "pac-1", "lab.pdf", "Hematocrito 45%")
    ok2 = pm.index_chat_document("cl-1", "pac-1", "lab.pdf", "Hematocrito 45%")
    assert ok1 and ok2
    # mismo contenido -> mismo source_id (posición 2 de los params del insert)
    assert llamadas["inserts"][0][2] == llamadas["inserts"][1][2]
    # contenido distinto -> source_id distinto
    pm.index_chat_document("cl-1", "pac-1", "lab.pdf", "Hematocrito 52%")
    assert llamadas["inserts"][2][2] != llamadas["inserts"][0][2]


def test_no_escribe_si_el_paciente_no_es_de_la_clinica(monkeypatch):
    llamadas = _capturar(monkeypatch, paciente_existe=False)
    assert pm.index_chat_document("cl-1", "pac-ajeno", "lab.pdf", "algo") is False
    assert llamadas["inserts"] == []


def test_sin_cohere_devuelve_false_sin_insertar(monkeypatch):
    llamadas = _capturar(monkeypatch)

    class _Caido:
        def __init__(self, *a, **k):
            pass

        def embed(self, *a, **k):
            raise EmbeddingError("cohere caído")

    monkeypatch.setattr(pm, "EmbeddingClient", _Caido)
    assert pm.index_chat_document("cl-1", "pac-1", "lab.pdf", "algo") is False
    assert llamadas["inserts"] == []


def test_texto_vacio_no_indexa(monkeypatch):
    llamadas = _capturar(monkeypatch)
    assert pm.index_chat_document("cl-1", "pac-1", "lab.pdf", "   ") is False
    assert llamadas["inserts"] == []
