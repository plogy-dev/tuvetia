"""Siembra y curación del glosario (sección 8). El glosario es GLOBAL, activo de la plataforma.

Siembra automática desde los términos MeSH del corpus + DeCS (entran como `candidate`).
Curación humana (veterinaria + coloquial) los pasa a `approved`. El retrieval usa solo `approved`.
"""


def seed_from_corpus_mesh() -> int:
    """Recorre metadata.mesh de corpus_chunks y crea glossary_term/synonym candidatos (EN)."""
    raise NotImplementedError("sembrar desde MeSH del corpus")


def seed_from_decs() -> int:
    """Agrega sinónimos en español (DeCS) mapeados a los descriptores MeSH."""
    raise NotImplementedError("sembrar sinónimos ES desde DeCS")


def approve_synonym(synonym_id: str, reviewer_id: str) -> None:
    """Marca un sinónimo como approved (curación veterinaria)."""
    raise NotImplementedError("candidate -> approved")
