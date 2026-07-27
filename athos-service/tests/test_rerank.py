"""Rerank: reordena sin romper. Lo crítico acá NO es que ordene bien (eso lo mide el golden
ampliado contra el corpus), sino que su ausencia o su fallo JAMÁS tumben el retrieval."""
import app.retrieval.cascade as csc
import app.retrieval.rerank as rr
from app.models import RetrievedChunk, StructuredQuery


def _chunks(n):
    return [RetrievedChunk(chunk_id=str(i), doc_id=str(i), content=f"doc {i}",
                           score=1.0 - i / 100, metadata={}) for i in range(n)]


def test_rerank_desactivado_recorta_sin_llamar_a_cohere(monkeypatch):
    monkeypatch.setattr(rr.get_settings(), "rerank_enabled", False, raising=False)

    def _no_llamar(*a, **k):
        raise AssertionError("no debe llamar a Cohere con el rerank desactivado")

    monkeypatch.setattr(rr, "_cohere_rerank", _no_llamar)
    out, aplicado = rr.rerank_chunks("consulta", _chunks(30), 15)
    assert aplicado is False
    assert len(out) == 15


def test_rerank_reordena_y_deja_score_en_metadata(monkeypatch):
    monkeypatch.setattr(rr.get_settings(), "rerank_enabled", True, raising=False)
    monkeypatch.setattr(rr.get_settings(), "rerank_api_key", "k", raising=False)
    monkeypatch.setattr(rr, "_cohere_rerank", lambda q, d, n, s: [(2, 0.9), (0, 0.4)])
    out, aplicado = rr.rerank_chunks("consulta", _chunks(5), 2)
    assert aplicado is True
    assert [c.chunk_id for c in out] == ["2", "0"]
    assert out[0].metadata["rerank_score"] == 0.9


def test_rerank_caido_devuelve_los_chunks_como_venian(monkeypatch):
    """Cohere sin key, lento o con 429: se sigue sin rerank, nunca se propaga el error."""
    monkeypatch.setattr(rr.get_settings(), "rerank_enabled", True, raising=False)
    monkeypatch.setattr(rr.get_settings(), "rerank_api_key", "k", raising=False)

    def _boom(*a, **k):
        raise rr.RerankUnavailable("timeout")

    monkeypatch.setattr(rr, "_cohere_rerank", _boom)
    out, aplicado = rr.rerank_chunks("consulta", _chunks(20), 15)
    assert aplicado is False
    assert [c.chunk_id for c in out] == [str(i) for i in range(15)]


def test_umbral_se_evalua_antes_del_rerank(monkeypatch):
    """El rerank cambia QUÉ literatura llega a la generación, nunca cuándo Athos se abstiene:
    si el rerank descartara el chunk de mayor score, el umbral no debe cambiar por eso."""
    fuertes = _chunks(4)
    monkeypatch.setattr(csc, "tier1_lexical_glossary", lambda q, f: fuertes)
    monkeypatch.setattr(csc, "tier2_vector_fallback", lambda q, f: [])
    # El rerank devuelve SOLO el peor chunk: el umbral ya se calculó sobre el set completo.
    monkeypatch.setattr(csc, "rerank_chunks", lambda q, c, n: ([c[-1]], True))
    chunks, passed = csc.retrieve(StructuredQuery(concepts=["x"], mesh=["X"], raw="x"))
    assert passed is True
    assert len(chunks) == 1
