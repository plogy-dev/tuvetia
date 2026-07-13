"""Cascada de recuperación (secciones 11.1-11.5). TODO determinístico: testeable sin IA.

Tier 0 filtros -> Tier 1 léxico+glosario -> (Tier 2 vector solo si Tier 1 es débil) -> umbral
-> fusión de contexto. El corpus es global; el contexto del paciente va por su propio camino
(RLS por clinic_id) y se fusiona EN MEMORIA. Nunca JOIN entre zonas.
"""
from app.models import StructuredQuery, RetrievedChunk, PatientContext


def tier0_filters(query: StructuredQuery) -> dict:
    """Filtros determinísticos: especie como PREFERENCIA (no exclusión; apóyate en MeSH Cats/Dogs),
    idioma, is_current, tier, recencia. Devuelve los criterios/boosts para la búsqueda."""
    raise NotImplementedError("Tier 0 filtros/boosts")


def tier1_lexical_glossary(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Léxico + glosario (gratis): conceptos vs mesh/glossary_terms del chunk + full-text (EN)
    sobre content (tsvector). Fusiona ambas listas y aplica boosts del Tier 0."""
    raise NotImplementedError("Tier 1 léxico + glosario")


def tier2_vector_fallback(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Vector de respaldo: embeddiza la consulta y busca sobre el conjunto filtrado (pgvector).
    Solo se llama si Tier 1 es débil. Loguear que se disparó (hueco del glosario)."""
    raise NotImplementedError("Tier 2 vector (pgvector)")


def passes_threshold(chunks: list[RetrievedChunk]) -> bool:
    """Score combinado (conceptos por tier/evidencia + recencia + especie). Arranca conservador;
    se calibra con el golden set. Determinístico."""
    raise NotImplementedError("umbral de evidencia")


def retrieve(query: StructuredQuery) -> tuple[list[RetrievedChunk], bool]:
    """Orquesta Tier 0/1/(2) y evalúa el umbral. Devuelve (chunks, passed_threshold)."""
    filters = tier0_filters(query)
    chunks = tier1_lexical_glossary(query, filters)
    # TODO (Claude Code): si chunks es débil -> tier2_vector_fallback y fusionar.
    return chunks, passes_threshold(chunks)


def fuse_context(literature: list[RetrievedChunk], patient: PatientContext) -> dict:
    """Une literatura (global) + contexto del paciente (por clínica) EN MEMORIA. Nunca en la DB."""
    raise NotImplementedError("fusión de contexto en memoria")
