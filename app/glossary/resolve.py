"""Resolución de conceptos: el corazón del puente ES->EN (parte determinística del paso A->B)."""
from app.models import StructuredQuery  # noqa: F401


def resolve_concepts(text: str, species: str | None) -> StructuredQuery:
    """Mapea las palabras del vet/dueño (ES) a conceptos canónicos.

    Busca en glossary_synonym (solo `approved`) -> resuelve glossary_term -> junta canonical_en,
    mesh_id y conceptos relacionados (glossary_relation). Devuelve una StructuredQuery.
    Sin IA, sin tokens.
    """
    raise NotImplementedError("resolver ES -> conceptos canónicos + mesh")
