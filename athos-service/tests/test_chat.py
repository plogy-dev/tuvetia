"""Chat: citas honestas por referencia numerada [n]. Determinístico, sin LLM ni DB."""
from app.chat import _cited_from_answer, _format_numbered
from app.models import RetrievedChunk


def _lit():
    return [
        RetrievedChunk(chunk_id="c1", doc_id="D1", content="renal disease ...", locator="A", source="PubMed"),
        RetrievedChunk(chunk_id="c2", doc_id="D2", content="cardiac ...", locator="B", source="PMC OA"),
        RetrievedChunk(chunk_id="c3", doc_id="D3", content="dermatology ...", locator="C", source="PubMed"),
    ]


def test_cited_solo_las_referenciadas_en_orden():
    """Devuelve solo las fuentes referenciadas por [n], en orden de aparición y sin duplicados."""
    ans = "Compatible con X [2]. También sugiere Y [1], y de nuevo [2]."
    cites = _cited_from_answer(ans, _lit())
    assert [c.chunk_id for c in cites] == ["c2", "c1"]
    assert cites[0].source == "PMC OA" and cites[0].locator == "B"


def test_cited_ignora_indices_fuera_de_rango():
    cites = _cited_from_answer("ver [9] y [2]", _lit())
    assert [c.chunk_id for c in cites] == ["c2"]


def test_cited_sin_marcadores_es_vacio():
    """Si el modelo no referencia ninguna fuente, no se adjunta ninguna cita (honesto)."""
    assert _cited_from_answer("respuesta general sin citas", _lit()) == []


def test_format_numbered_enumera_desde_1():
    txt = _format_numbered(_lit())
    assert "[1] fuente=PubMed" in txt
    assert "[2] fuente=PMC OA" in txt
    assert "[3] fuente=PubMed" in txt


def test_format_numbered_vacio():
    assert "sin literatura" in _format_numbered([])
