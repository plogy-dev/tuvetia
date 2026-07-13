"""Pipeline de ingesta del corpus (sección 9 del documento final).

El proveedor entrega markdown + frontmatter YAML (validados, en inglés). Aquí:
idempotente por content_hash -> frontmatter a metadata -> normalizar -> chunking con locator
(no partir tablas/dosis) -> embedding (una vez) -> tsvector por idioma -> etiquetar con glosario.
El corpus es GLOBAL: la tabla corpus_chunks no lleva clinic_id.
"""
from app.models import RetrievedChunk  # noqa: F401  (tipos de apoyo)


def parse_document(md_text: str) -> tuple[dict, str]:
    """Separa el frontmatter YAML del cuerpo markdown. Devuelve (metadata, body)."""
    raise NotImplementedError("parsear frontmatter + cuerpo")


def chunk_document(body: str, metadata: dict) -> list[dict]:
    """Trocea el cuerpo (~500-800 tokens, ~10-15% solape) SIN partir tablas ni dosis.

    Cada chunk hereda la metadata + un `locator` (sección/posición) + `ordinal`.
    """
    raise NotImplementedError("chunking con locator")


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embeddiza textos con Cohere embed-v4 (dim = EMBEDDING_DIM) vía EmbeddingClient."""
    from app.embeddings import EmbeddingClient
    return EmbeddingClient().embed(texts, input_type="search_document")


def tag_with_glossary(chunk: dict) -> list[str]:
    """Devuelve los glossary_term ids presentes en el chunk (solo sinónimos `approved`) + su mesh."""
    raise NotImplementedError("etiquetado con glosario")


def upsert_chunks(chunks: list[dict]) -> None:
    """Inserta/actualiza en corpus_chunks (content, embedding, tsv, metadata). Global, sin clinic_id."""
    raise NotImplementedError("upsert en corpus_chunks + tsvector por idioma")


def ingest_document(md_text: str) -> int:
    """Ingesta un documento completo. Idempotente por content_hash. Devuelve nº de chunks."""
    raise NotImplementedError("orquestar: hash -> parse -> chunk -> embed -> tag -> upsert")
