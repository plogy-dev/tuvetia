"""Ingesta determinística (sin red): parseo de frontmatter y chunking con locator."""
import app.ingestion.pipeline as pl
from app.ingestion.pipeline import parse_document, chunk_document

SAMPLE = """---
id: PM123
especie: gato
mesh:
- Cats
- Sporotrichosis
tier: A
---

# Titulo del documento

Primer parrafo de introduccion sobre el tema clinico.

## The Study

Segundo parrafo con detalles del estudio y los resultados observados.

| Farmaco | Dosis |
| --- | --- |
| itraconazol | 10 mg/kg |

## Conclusions

Parrafo final con las conclusiones del trabajo.
"""


def test_parse_frontmatter_separa_yaml_y_cuerpo():
    meta, body = parse_document(SAMPLE)
    assert meta["id"] == "PM123"
    assert meta["especie"] == "gato"
    assert meta["mesh"] == ["Cats", "Sporotrichosis"]
    assert body.startswith("# Titulo del documento")
    assert "id: PM123" not in body  # el YAML no se filtra al cuerpo


def test_sin_frontmatter_devuelve_texto_completo():
    meta, body = parse_document("solo cuerpo, sin frontmatter")
    assert meta == {}
    assert body == "solo cuerpo, sin frontmatter"


def test_chunk_hereda_metadata_y_locator():
    meta, body = parse_document(SAMPLE)
    chunks = chunk_document(body, meta)
    assert chunks, "debe producir al menos un chunk"
    assert [c["ordinal"] for c in chunks] == list(range(len(chunks)))  # ordinales secuenciales
    assert all(c["metadata"]["id"] == "PM123" for c in chunks)          # hereda metadata
    locators = {c["locator"] for c in chunks}
    assert locators & {"Titulo del documento", "The Study", "Conclusions"}


def test_no_parte_tablas_con_chunks_pequenos(monkeypatch):
    """Aun forzando chunks minusculos, la tabla completa vive en un solo chunk (no se parte)."""
    monkeypatch.setattr(pl, "MAX_TOKENS", 15)
    monkeypatch.setattr(pl, "OVERLAP_TOKENS", 3)
    meta, body = parse_document(SAMPLE)
    chunks = pl.chunk_document(body, meta)
    assert len(chunks) > 1  # de verdad se troceo
    fila = "| itraconazol | 10 mg/kg |"
    holders = [c for c in chunks if fila in c["content"]]
    assert len(holders) == 1
    assert "| Farmaco | Dosis |" in holders[0]["content"]  # encabezado y fila juntos
