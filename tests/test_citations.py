"""Verificación de citas: solo sobreviven las que mapean a un chunk recuperado."""
from app.models import Citation
from app.generation.citations import verify_citations


def test_descarta_cita_inventada(sample_chunks):
    """Una cita a un chunk_id inexistente debe descartarse; la válida sobrevive."""
    cited = [
        Citation(chunk_id="c1", doc_id="PM16485488", locator="The Study", source="PubMed"),
        Citation(chunk_id="cX", doc_id="INVENTADO", locator="?", source="?"),
    ]
    verified = verify_citations("texto de la respuesta", cited, sample_chunks)
    assert [c.chunk_id for c in verified] == ["c1"]


def test_sin_match_no_sobrevive_ninguna(sample_chunks):
    cited = [Citation(chunk_id="zzz", doc_id="x")]
    assert verify_citations("t", cited, sample_chunks) == []


def test_dedup_por_chunk_id(sample_chunks):
    cited = [Citation(chunk_id="c1", doc_id="d"), Citation(chunk_id="c1", doc_id="d")]
    assert len(verify_citations("t", cited, sample_chunks)) == 1
