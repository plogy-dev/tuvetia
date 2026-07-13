"""Paso A->B (sección 11.0): arma la consulta. Glosario primero; LLM liviano solo de respaldo."""
from app.models import StructuredQuery
from app.glossary.resolve import resolve_concepts


def build_query(text: str, species: str | None) -> StructuredQuery:
    """Construye la StructuredQuery.

    1) resolve_concepts(text, species)  (determinístico).
    2) Si la detección queda pobre (pocos conceptos), un LLM liviano (LLM_LIGHT_MODEL) distila
       la consulta y se reintenta la resolución. Loguear en rag_retrieval_log.
    """
    q = resolve_concepts(text, species)
    # TODO (Claude Code): fallback con LLM_LIGHT_MODEL si len(q.concepts) es insuficiente.
    return q
