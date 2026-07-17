"""Cascada determinística (sin LLM): preferencia de especie, umbral, fusión de contexto."""
from app.models import RetrievedChunk, StructuredQuery, PatientContext
from app.retrieval.cascade import (
    tier0_filters, rank_chunks, passes_threshold, fuse_context, tier1_lexical_glossary, _vector_search,
)


def _chunk(cid: str, especie: str, mesh: list[str], score: float) -> RetrievedChunk:
    return RetrievedChunk(chunk_id=cid, doc_id=cid, content="...", score=score,
                          metadata={"especie": especie, "mesh": mesh, "is_current": True})


def test_especie_es_preferencia_no_exclusion():
    """Para un gato, el chunk felino rankea por encima del de ave, sin excluir 'mixto'."""
    chunks = [
        _chunk("felino", "gato", ["Cats", "Sporotrichosis"], 0.5),
        _chunk("ave", "ave", ["Birds"], 0.5),
        _chunk("mixto", "mixto", [], 0.5),
    ]
    ranked = rank_chunks(chunks, tier0_filters(StructuredQuery(species="gato", raw="micosis gato")))
    assert ranked[0].chunk_id == "felino"
    assert {c.chunk_id for c in ranked} == {"felino", "ave", "mixto"}  # nada se excluye


def test_umbral_se_abstiene_sin_evidencia():
    """Si el mejor score no supera el umbral, passes_threshold debe ser False."""
    filters = tier0_filters(StructuredQuery(species="gato"))
    assert passes_threshold([]) is False
    debil = rank_chunks([_chunk("d", "gato", [], 0.05)], filters)
    assert passes_threshold(debil) is False
    fuerte = rank_chunks([_chunk("f", "gato", ["Cats"], 0.9)], filters)
    assert passes_threshold(fuerte) is True


def test_fuse_context_separa_zonas():
    """La fusión mantiene literatura (global) y paciente (por clínica) en zonas separadas."""
    lit = [_chunk("c1", "gato", ["Cats"], 0.9)]
    pat = PatientContext(patient_id="luna", species="perro", severe_allergies=["pollo"])
    fused = fuse_context(lit, pat)
    assert fused["literature"] is lit
    assert fused["patient"].patient_id == "luna"
    assert fused["severe_allergies"] == ["pollo"]


def test_tier1_encuentra_por_mesh(require_db):
    """Tier 1 recupera chunks del corpus por descriptor MeSH (integración contra la DB)."""
    import pytest
    from app.db import fetch_all
    row = fetch_all(
        "select metadata->'mesh'->>0 m from public.corpus_chunks "
        "where metadata ? 'mesh' and jsonb_array_length(metadata->'mesh') > 0 limit 1"
    )
    if not row or not row[0]["m"]:
        pytest.skip("corpus sin descriptores MeSH")
    descriptor = row[0]["m"]
    q = StructuredQuery(concepts=[descriptor], mesh=[descriptor], raw=descriptor)
    chunks = tier1_lexical_glossary(q, tier0_filters(q))
    assert chunks
    assert any(descriptor in (c.metadata.get("mesh") or []) for c in chunks)


def test_tier2_vector_recupera_el_mismo_chunk(require_db):
    """El SQL del Tier 2 se valida reusando un embedding ya guardado (sin llamar a Cohere)."""
    import json
    import pytest
    from app.db import fetch_all
    row = fetch_all(
        "select id, embedding::text emb from public.corpus_chunks where embedding is not null limit 1"
    )
    if not row:
        pytest.skip("corpus sin embeddings")
    vec = json.loads(row[0]["emb"])
    res = _vector_search(vec, 3)
    assert res
    assert res[0].chunk_id == str(row[0]["id"])   # el vecino más cercano de un vector es él mismo
    assert res[0].score > 0.99


def test_retrieve_degrada_si_tier2_falla(monkeypatch):
    """Si el Tier 1 es débil y el Tier 2 no puede embeddizar (sin Cohere), retrieve NO rompe:
    se queda con el Tier 1 y se abstiene. Determinístico (sin DB ni red)."""
    import app.retrieval.cascade as csc
    from app.embeddings import EmbeddingQuotaExceeded
    monkeypatch.setattr(csc, "tier1_lexical_glossary", lambda q, f: [])

    def _boom(q, f):
        raise EmbeddingQuotaExceeded("trial agotada")

    monkeypatch.setattr(csc, "tier2_vector_fallback", _boom)
    chunks, passed = csc.retrieve(StructuredQuery(concepts=["x"], mesh=["x"], raw="x"))
    assert chunks == []
    assert passed is False
