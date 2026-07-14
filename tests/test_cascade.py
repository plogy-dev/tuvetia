"""Cascada determinística (sin LLM): preferencia de especie, umbral, fusión de contexto."""
from app.models import RetrievedChunk, StructuredQuery, PatientContext
from app.retrieval.cascade import tier0_filters, rank_chunks, passes_threshold, fuse_context


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
