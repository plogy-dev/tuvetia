"""Verificación de citas: solo sobreviven las que mapean a un chunk recuperado."""
from app.models import Citation, RetrievedChunk
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


def test_cita_se_reconstruye_desde_el_chunk_con_url_title_year():
    """La cita verificada toma url/title/year/source/locator del CHUNK (corpus), ignorando lo que
    el modelo haya puesto: el LLM solo elige el chunk_id, nunca inventa la fuente."""
    chunk = RetrievedChunk(
        chunk_id="c9", doc_id="PM24884635", content="feline CKD ...", locator="Discussion",
        source="PubMed",
        metadata={"url": "https://pubmed.ncbi.nlm.nih.gov/24884635/", "titulo": "Feline CKD review",
                  "year": "2019"})
    cited = [Citation(chunk_id="c9", doc_id="loquesea", locator="?", source="inventado")]
    v = verify_citations("t", cited, [chunk])
    assert len(v) == 1
    c = v[0]
    assert c.url == "https://pubmed.ncbi.nlm.nih.gov/24884635/"
    assert c.title == "Feline CKD review"
    assert c.year == 2019                                  # "2019" -> int
    assert c.source == "PubMed" and c.locator == "Discussion"   # del chunk, no del modelo


def test_from_chunk_tolera_year_ausente_o_invalido():
    chunk = RetrievedChunk(chunk_id="c1", doc_id="d", content="x", metadata={"year": "s/f"})
    assert Citation.from_chunk(chunk).year is None
    chunk2 = RetrievedChunk(chunk_id="c2", doc_id="d", content="x", metadata={})
    assert Citation.from_chunk(chunk2).year is None and Citation.from_chunk(chunk2).url is None
