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
    """El juez genera vía `ProviderCascade`, que resuelve el cliente en SU módulo: se parchea ahí.

    Antes se parcheaba `app.generation.llm_client` y funcionaba porque el juez lo importaba
    directo. Al pasar por la cascada ese parche dejó de interceptar y las pruebas salían a la red.
    """
    import app.generation.provider_cascade as mod
    monkeypatch.setattr(mod, "LLMClient", _FakeLLM(raw))


# --- Bandas -----------------------------------------------------------------------------------

def test_band_for_cortes():
    """0-2 abstención dura; 3-6 evidencia limitada; 7+ normal.

    Calibrados el 2026-07-30 sobre el banco COMPLETO (188 casos) contra una verdad mecánica, y
    JUNTO con la corroboración determinística: los cortes solos no explican el resultado. Seguridad
    82,4% -> 92,6% y utilidad 63,3% -> 65,5%. Detalle en `app/config.py`.
    """
    assert [band_for(s) for s in (0, 1, 2)] == [EVIDENCE_NONE] * 3
    assert [band_for(s) for s in (3, 5, 6)] == [EVIDENCE_LIMITED] * 3
    assert [band_for(s) for s in (7, 9, 10)] == [EVIDENCE_SUFFICIENT] * 3


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
    _patch_llm(monkeypatch, '{"puntaje": 5, "cubre": false, "motivo": "misma especie, otra cosa"}')
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
    import app.generation.provider_cascade as mod
    monkeypatch.setattr(mod, "LLMClient", _boom)
    v = judge_evidence("q", [])
    assert v.abstains and v.judged is True


def test_judge_error_del_proveedor_falla_abierto(monkeypatch):
    class _Boom:
        def __init__(self, *a, **k):
            pass

        def complete(self, *a, **k):
            raise RuntimeError("HTTP 503")
    import app.generation.provider_cascade as mod
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
    import app.generation.provider_cascade as mod
    monkeypatch.setattr(mod, "LLMClient", _boom)
    v = judge_evidence("q", _chunks())
    assert v.band == EVIDENCE_SUFFICIENT and v.judged is False


# ---------------------------------------------------------------------------------------------
# CORROBORACIÓN DETERMINÍSTICA
#
# El juez solo llegaba a 82,4% de seguridad. Cruzar su veredicto con un HECHO comprobable —¿algún
# descriptor MeSH de la consulta está indexado en la literatura recuperada?— lo sube a 92,6% sin
# costar una llamada. Medición completa: `docs/ABSTENCION-MEDICION-2026-07-30.md`.
# ---------------------------------------------------------------------------------------------
from app.generation.evidence_judge import (  # noqa: E402
    corroborar, hay_descriptor_corroborante,
)


def _chunk_con_mesh(*descriptores):
    return RetrievedChunk(chunk_id="c1", doc_id="d1", source="s", content="x",
                          score=1.0, metadata={"mesh": list(descriptores)})


class TestHayDescriptorCorroborante:
    def test_coincide_una_condicion_concreta(self):
        assert hay_descriptor_corroborante(["Dermatitis"], [_chunk_con_mesh("Dermatitis", "Dogs")])

    def test_la_especie_sola_no_corrobora(self):
        """'Dogs' está en 43k chunks: coincide con cualquier consulta canina y no prueba nada.

        Es el mismo error que saturaba el score determinístico (1.701 vs 1.700).
        """
        assert not hay_descriptor_corroborante(["Dogs"], [_chunk_con_mesh("Dogs", "Anemia")])

    def test_un_descriptor_generico_no_corrobora(self):
        """'Recurrence' o 'Syndrome' aparecen en cualquier texto clínico: sólo cuentan los que
        nombran una CONDICIÓN concreta (mismo criterio que usa el A->B)."""
        assert not hay_descriptor_corroborante(["Recurrence"], [_chunk_con_mesh("Recurrence")])

    def test_sin_descriptores_de_consulta_no_corrobora(self):
        assert not hay_descriptor_corroborante([], [_chunk_con_mesh("Dermatitis")])
        assert not hay_descriptor_corroborante(None, [_chunk_con_mesh("Dermatitis")])

    def test_sin_coincidencia_no_corrobora(self):
        assert not hay_descriptor_corroborante(["Babesiosis"], [_chunk_con_mesh("Dermatitis")])

    def test_no_distingue_mayusculas(self):
        assert hay_descriptor_corroborante(["dermatitis"], [_chunk_con_mesh("Dermatitis")])

    def test_chunk_sin_metadata_no_revienta(self):
        c = RetrievedChunk(chunk_id="c", doc_id="d", source="s", content="x", score=1.0)
        assert not hay_descriptor_corroborante(["Dermatitis"], [c])


class TestCorroborar:
    def test_freno_baja_a_limitada_sin_descriptor(self):
        """Dice 'suficiente' pero ningún documento está indexado con la condición: es
        plausibilidad temática, no cobertura. En 520k chunks siempre hay algo que suena parecido."""
        assert corroborar(EVIDENCE_SUFFICIENT, 8.0, False) == EVIDENCE_LIMITED

    def test_el_freno_respeta_la_certeza_maxima(self):
        """Con puntaje 10 no se le contradice al juez: el corte se calibró en 9."""
        assert corroborar(EVIDENCE_SUFFICIENT, 10.0, False) == EVIDENCE_SUFFICIENT

    def test_sin_freno_si_hay_descriptor(self):
        assert corroborar(EVIDENCE_SUFFICIENT, 8.0, True) == EVIDENCE_SUFFICIENT

    def test_rescate_sube_de_abstencion_a_limitada(self):
        """Callarse del todo teniendo literatura indexada con la condición es el error más caro."""
        assert corroborar(EVIDENCE_NONE, 1.0, True) == EVIDENCE_LIMITED

    def test_sin_rescate_si_no_hay_descriptor(self):
        assert corroborar(EVIDENCE_NONE, 1.0, False) == EVIDENCE_NONE

    def test_la_banda_limitada_no_se_toca(self):
        assert corroborar(EVIDENCE_LIMITED, 4.0, True) == EVIDENCE_LIMITED
        assert corroborar(EVIDENCE_LIMITED, 4.0, False) == EVIDENCE_LIMITED

    def test_sin_puntaje_no_se_corrobora(self):
        """Falla abierta: sin puntaje no hubo juicio y no se castiga al veterinario."""
        assert corroborar(EVIDENCE_SUFFICIENT, None, False) == EVIDENCE_SUFFICIENT


def test_judge_evidence_aplica_el_freno(monkeypatch):
    """De punta a punta: el juez dice 8 (suficiente) y sin descriptor coincidente baja a limitada."""
    _patch_llm(monkeypatch, '{"puntaje": 8, "cubre": true, "motivo": "trata el tema"}')
    v = judge_evidence("q", [_chunk_con_mesh("Anemia")], query_mesh=["Babesiosis"])
    assert v.band == EVIDENCE_LIMITED
    assert v.score == 8.0            # el puntaje del juez se conserva para la traza


def test_judge_evidence_sin_query_mesh_se_comporta_como_antes(monkeypatch):
    """La corroboración es aditiva: sin descriptores de consulta, el veredicto es el del juez."""
    _patch_llm(monkeypatch, '{"puntaje": 8, "cubre": true, "motivo": "trata el tema"}')
    assert judge_evidence("q", [_chunk_con_mesh("Anemia")]).band == EVIDENCE_SUFFICIENT
