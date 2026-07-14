"""Cascada de recuperación (secciones 11.1-11.5). Núcleo determinístico: testeable sin IA.

Tier 0 filtros/boosts -> Tier 1 léxico+glosario -> (Tier 2 vector solo si Tier 1 es débil) ->
umbral -> fusión de contexto. El corpus es global; el contexto del paciente va por su propio
camino (RLS por clinic_id) y se fusiona EN MEMORIA. Nunca JOIN entre zonas.
"""
from app.models import StructuredQuery, RetrievedChunk, PatientContext

# --- Parámetros determinísticos (se calibran con el golden set; arrancan conservadores) ---
THRESHOLD = 0.35        # score del mejor chunk para NO abstenerse
SPECIES_BOOST = 0.15    # preferencia por especie (NO exclusión)
CURRENT_BOOST = 0.05    # documento vigente (is_current)
CONCEPT_BOOST = 0.05    # por cada coincidencia de MeSH/concepto (tope 3)
TIER_BOOST = {"A": 0.05, "B": 0.02, "C": 0.0}

# Especie (ES, de la ficha) -> descriptores MeSH del corpus. 'mixto' no mapea: no se excluye.
SPECIES_MESH = {
    "gato": ["Cats", "Cat Diseases"],
    "perro": ["Dogs", "Dog Diseases"],
    "ave": ["Birds", "Bird Diseases"],
    "conejo": ["Rabbits"],
    "reptil": ["Reptiles"],
    "roedor": ["Rodentia", "Rodent Diseases"],
    "huron": ["Ferrets"],
}


def tier0_filters(query: StructuredQuery) -> dict:
    """Filtros/boosts determinísticos (no tocan la DB). Especie = PREFERENCIA, no exclusión
    (se apoya en MeSH Cats/Dogs); idioma, is_current, tier y conceptos/MeSH para el ranking."""
    species = (query.species or "").lower() or None
    return {
        "species": species,
        "preferred_species_mesh": SPECIES_MESH.get(species or "", []),
        "language": query.language,
        "require_is_current": True,
        "concepts": list(query.concepts),
        "mesh": list(query.mesh),
    }


def _matches_species(chunk: RetrievedChunk, filters: dict) -> bool:
    md = chunk.metadata or {}
    if filters.get("species") and str(md.get("especie", "")).lower() == filters["species"]:
        return True
    preferred = set(filters.get("preferred_species_mesh") or [])
    return bool(preferred & set(md.get("mesh") or []))


def score_chunk(chunk: RetrievedChunk, filters: dict) -> float:
    """Score combinado y determinístico: relevancia base (léxico/vector, ya en chunk.score) +
    preferencia de especie + coincidencia de MeSH/conceptos + vigencia + tier."""
    md = chunk.metadata or {}
    score = float(chunk.score)
    if _matches_species(chunk, filters):
        score += SPECIES_BOOST
    overlap = set(filters.get("mesh") or []) & set(md.get("mesh") or [])
    score += min(len(overlap), 3) * CONCEPT_BOOST
    if md.get("is_current"):
        score += CURRENT_BOOST
    score += TIER_BOOST.get(str(md.get("tier", "")).upper(), 0.0)
    return score


def rank_chunks(chunks: list[RetrievedChunk], filters: dict) -> list[RetrievedChunk]:
    """Aplica el score determinístico y ordena de mayor a menor. NO excluye por especie: la
    especie es preferencia (boost), no filtro; 'mixto' y otras especies siguen presentes."""
    for c in chunks:
        c.score = score_chunk(c, filters)
    return sorted(chunks, key=lambda c: c.score, reverse=True)


def passes_threshold(chunks: list[RetrievedChunk]) -> bool:
    """True si el mejor score supera el umbral. Sin chunks -> False (Athos se abstiene)."""
    if not chunks:
        return False
    return max(c.score for c in chunks) >= THRESHOLD


def tier1_lexical_glossary(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Léxico + glosario (gratis): conceptos vs mesh/glossary_terms del chunk + full-text (EN)
    sobre content (tsvector). Fusiona ambas listas y aplica el ranking del Tier 0. (Usa la DB.)"""
    raise NotImplementedError("Tier 1 léxico + glosario (DB)")


def tier2_vector_fallback(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Vector de respaldo: embeddiza la consulta y busca sobre el conjunto filtrado (pgvector).
    Solo se llama si Tier 1 es débil. Loguear que se disparó (hueco del glosario)."""
    raise NotImplementedError("Tier 2 vector (pgvector)")


def retrieve(query: StructuredQuery) -> tuple[list[RetrievedChunk], bool]:
    """Orquesta Tier 0/1/(2), rankea y evalúa el umbral. Devuelve (chunks, passed_threshold)."""
    filters = tier0_filters(query)
    chunks = rank_chunks(tier1_lexical_glossary(query, filters), filters)
    # TODO (Claude Code): si es débil -> tier2_vector_fallback + re-rank/fusión.
    return chunks, passes_threshold(chunks)


def fuse_context(literature: list[RetrievedChunk], patient: PatientContext) -> dict:
    """Une literatura (global) + contexto del paciente (por clínica) EN MEMORIA, en zonas
    separadas. Nunca en la DB, nunca por JOIN. Expone las alergias severas para el gate."""
    return {
        "literature": literature,
        "patient": patient,
        "severe_allergies": list(patient.severe_allergies),
    }
