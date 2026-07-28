"""Juez semántico de la evidencia (la abstención real de Athos). Sin LLM ni DB: se mockea el cliente.

Lo que fija: los cortes de banda, el parseo robusto del JSON y —sobre todo— que el juez FALLE
ABIERTO. Callar por un error nuestro (proveedor caído, JSON roto, timeout) sería peor que responder:
el vet perdería una respuesta que la literatura sí sostenía.
"""
import app.generation.evidence_judge as ej
from app.generation.evidence_judge import (EvidenceVerdict, band_for, judge_evidence)
from app.models import (EVIDENCE_LIMITED, EVIDENCE_NONE, EVIDENCE_SUFFICIENT, RetrievedChunk)


def _chunks(n: int = 3) -> list[RetrievedChunk]:
    return [RetrievedChunk(chunk_id=f"c{i}", doc_id=f"D{i}", content=f"passage {i} about canine ...")
            for i in range(1, n + 1)]


class _FakeLLM:
    """Cliente LLM de mentira: devuelve `raw` y registra el prompt que recibió."""
    last: dict = {}

    def __init__(self, raw):
        self.raw = raw

    def __call__(self, *a, **k):
        _FakeLLM.last["model"] = k.get("model")
        return self

    def complete(self, system, user, max_tokens=2000):
        _FakeLLM.last["system"] = system
        _FakeLLM.last["user"] = user
        return self.raw


def _patch_llm(monkeypatch, raw):
    """El juez importa LLMClient perezosamente desde app.generation.llm_client: se parchea ahí."""
    import app.generation.llm_client as mod
    monkeypatch.setattr(mod, "LLMClient", _FakeLLM(raw))


# --- Bandas -----------------------------------------------------------------------------------

def test_band_for_cortes():
    """0-2 abstención dura; 3-5 evidencia limitada; 6+ normal (medido sobre 187 casos)."""
    assert [band_for(s) for s in (0, 1, 2)] == [EVIDENCE_NONE] * 3
    assert [band_for(s) for s in (3, 4, 5)] == [EVIDENCE_LIMITED] * 3
    assert [band_for(s) for s in (6, 8, 10)] == [EVIDENCE_SUFFICIENT] * 3


def test_band_for_sin_puntaje_falla_abierta():
    assert band_for(None) == EVIDENCE_SUFFICIENT


def test_verdict_helpers():
    assert EvidenceVerdict(band=EVIDENCE_NONE).abstains is True
    assert EvidenceVerdict(band=EVIDENCE_LIMITED).is_limited is True
    assert EvidenceVerdict(band=EVIDENCE_SUFFICIENT).abstains is False


# --- Juicio -----------------------------------------------------------------------------------

def test_judge_puntaje_bajo_abstiene(monkeypatch):
    _patch_llm(monkeypatch, '{"puntaje": 1, "cubre": false, "motivo": "hablan de otra cosa"}')
    v = judge_evidence("¿cómo trato el moquillo?", _chunks())
    assert v.abstains and v.judged is True
    assert v.score == 1.0 and v.reason == "hablan de otra cosa"


def test_judge_puntaje_medio_es_limitado(monkeypatch):
    _patch_llm(monkeypatch, '{"puntaje": 4, "cubre": false, "motivo": "misma especie, otra cosa"}')
    assert judge_evidence("q", _chunks()).band == EVIDENCE_LIMITED


def test_judge_puntaje_alto_responde_normal(monkeypatch):
    _patch_llm(monkeypatch, '{"puntaje": 8, "cubre": true, "motivo": "trata la condición"}')
    assert judge_evidence("q", _chunks()).band == EVIDENCE_SUFFICIENT


def test_judge_tolera_json_envuelto_en_texto(monkeypatch):
    """Los modelos suelen envolver el JSON en ``` o prosa: se extrae igual."""
    _patch_llm(monkeypatch, 'Claro:\n```json\n{"puntaje": 0, "cubre": false}\n```')
    assert judge_evidence("q", _chunks()).abstains is True


def test_judge_acota_el_puntaje_al_rango(monkeypatch):
    _patch_llm(monkeypatch, '{"puntaje": 99}')
    assert judge_evidence("q", _chunks()).score == 10.0


def test_judge_solo_ve_los_mejores_pasajes(monkeypatch, ):
    """Lee `judge_passages` (6) chunks: los del tope, ya reordenados por el reranker."""
    _patch_llm(monkeypatch, '{"puntaje": 7}')
    judge_evidence("q", _chunks(10))
    user = _FakeLLM.last["user"]
    assert "[6]" in user and "[7]" not in user


# --- Falla abierta ----------------------------------------------------------------------------

def test_judge_sin_literatura_abstiene_sin_llamar_al_llm(monkeypatch):
    """No hay nada que leer: la abstención es determinística y no cuesta un token."""
    def _boom(*a, **k):
        raise AssertionError("no debe llamar al LLM sin literatura")
    import app.generation.llm_client as mod
    monkeypatch.setattr(mod, "LLMClient", _boom)
    v = judge_evidence("q", [])
    assert v.abstains and v.judged is True


def test_judge_error_del_proveedor_falla_abierto(monkeypatch):
    class _Boom:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            raise RuntimeError("HTTP 503")
    import app.generation.llm_client as mod
    monkeypatch.setattr(mod, "LLMClient", _Boom)
    v = judge_evidence("q", _chunks())
    assert v.band == EVIDENCE_SUFFICIENT and v.judged is False and v.abstains is False


def test_judge_respuesta_ilegible_falla_abierto(monkeypatch):
    _patch_llm(monkeypatch, "no soy JSON")
    v = judge_evidence("q", _chunks())
    assert v.band == EVIDENCE_SUFFICIENT and v.judged is False


def test_judge_puntaje_no_numerico_falla_abierto(monkeypatch):
    _patch_llm(monkeypatch, '{"puntaje": "alto", "cubre": true}')
    assert judge_evidence("q", _chunks()).judged is False


def test_judge_bool_no_cuenta_como_puntaje(monkeypatch):
    """`True` es int en Python: no debe colarse como puntaje 1 (que abstendría)."""
    _patch_llm(monkeypatch, '{"puntaje": true}')
    v = judge_evidence("q", _chunks())
    assert v.judged is False and v.abstains is False


def test_judge_apagado_no_llama_al_llm(monkeypatch):
    """JUDGE_ENABLED=false -> se responde sin juzgar (interruptor de emergencia)."""
    monkeypatch.setattr(ej.get_settings(), "judge_enabled", False)
    def _boom(*a, **k):
        raise AssertionError("el juez está apagado: no debe llamar al LLM")
    import app.generation.llm_client as mod
    monkeypatch.setattr(mod, "LLMClient", _boom)
    v = judge_evidence("q", _chunks())
    assert v.band == EVIDENCE_SUFFICIENT and v.judged is False
