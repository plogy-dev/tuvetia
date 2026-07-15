"""Cascada de recuperación (secciones 11.1-11.5). Núcleo determinístico: testeable sin IA.

Tier 0 filtros/boosts -> Tier 1 léxico+glosario -> (Tier 2 vector solo si Tier 1 es débil) ->
umbral -> fusión de contexto. El corpus es global; el contexto del paciente va por su propio
camino (RLS por clinic_id) y se fusiona EN MEMORIA. Nunca JOIN entre zonas.
"""
from app.db import fetch_all
from app.embeddings import EmbeddingError
from app.models import PatientContext, RetrievedChunk, StructuredQuery

# --- Parámetros determinísticos (se calibran con el golden set; arrancan conservadores) ---
THRESHOLD = 0.35        # score del mejor chunk para NO abstenerse
SPECIES_BOOST = 0.15    # preferencia por especie (NO exclusión)
CURRENT_BOOST = 0.05    # documento vigente (is_current)
CONCEPT_BOOST = 0.05    # por cada coincidencia de MeSH/concepto (tope 3)
TIER_BOOST = {"A": 0.05, "B": 0.02, "C": 0.0}

# Bases de relevancia del Tier 1 (señales binarias fuertes, luego se afinan con boosts del Tier 0).
TIER1_MESH_BASE = 0.6   # el chunk trae un MeSH/concepto de la consulta: evidencia fuerte
TIER1_LEX_BASE = 0.4    # match de full-text (léxico)
TIER1_LIMIT = 40        # candidatos que trae el Tier 1
TIER2_LIMIT = 40        # candidatos que trae el Tier 2 (vector)
WEAK_MIN_RESULTS = 3    # menos candidatos que esto (o no pasar umbral) dispara el Tier 2

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

# idioma de la consulta -> config de full-text. El corpus está en inglés.
_TS_CONFIG = {"en": "english", "es": "spanish", "pt": "portuguese"}


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


def _ts_config(language: str | None) -> str:
    return _TS_CONFIG.get((language or "en").lower(), "english")


def _to_chunk(row: dict, base: float) -> RetrievedChunk:
    md = row.get("metadata") or {}
    return RetrievedChunk(
        chunk_id=str(row["id"]),
        doc_id=str(md.get("id") or row["id"]),
        content=row["content"],
        locator=md.get("locator"),
        source=row.get("source"),
        score=base,
        metadata=md,
    )


def tier1_lexical_glossary(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Léxico + glosario (gratis): full-text (config del idioma) sobre content + match de
    conceptos/MeSH contra metadata->'mesh'. Base = 0.6 (MeSH) + 0.4 (léxico). Usa la DB."""
    concepts = filters.get("concepts") or list(query.concepts)
    mesh = filters.get("mesh") or list(query.mesh)
    cfg = _ts_config(filters.get("language"))
    terms = " or ".join(concepts)  # websearch_to_tsquery entiende OR
    rows = fetch_all(
        "select id, source, title, content, metadata, "
        "  ts_rank_cd(tsv, websearch_to_tsquery(%s, %s)) as lex, "
        "  (metadata->'mesh' ?| %s) as mesh_hit "
        "from public.corpus_chunks "
        "where tsv @@ websearch_to_tsquery(%s, %s) or metadata->'mesh' ?| %s "
        "order by lex desc nulls last limit %s",
        (cfg, terms, mesh, cfg, terms, mesh, TIER1_LIMIT),
    )
    out = []
    for r in rows:
        lex = float(r["lex"] or 0.0)
        base = (TIER1_MESH_BASE if r["mesh_hit"] else 0.0)
        base += (TIER1_LEX_BASE if lex > 0 else 0.0)
        base += min(lex, 0.999) * 0.001  # micro-desempate por ranking léxico
        out.append(_to_chunk(r, base))
    return out


def _vector_search(vector: list[float], limit: int) -> list[RetrievedChunk]:
    """Búsqueda vectorial (pgvector, coseno) sobre el corpus. Recibe el vector ya calculado, así
    el camino SQL es testeable reutilizando un embedding ya guardado (sin llamar a Cohere)."""
    emb = "[" + ",".join(f"{x:.7f}" for x in vector) + "]"
    rows = fetch_all(
        "select id, source, title, content, metadata, 1 - (embedding <=> %s::vector) as sim "
        "from public.corpus_chunks where embedding is not null "
        "order by embedding <=> %s::vector limit %s",
        (emb, emb, limit),
    )
    return [_to_chunk(r, float(r["sim"])) for r in rows]


def tier2_vector_fallback(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Vector de respaldo: embeddiza la consulta (Cohere, input_type=search_query) y busca sobre
    el corpus. Solo se llama si el Tier 1 es débil (hueco del glosario). Requiere Cohere."""
    from app.embeddings import EmbeddingClient
    vector = EmbeddingClient().embed([query.raw], input_type="search_query")[0]
    return _vector_search(vector, TIER2_LIMIT)


def _is_weak(chunks: list[RetrievedChunk]) -> bool:
    return len(chunks) < WEAK_MIN_RESULTS or not passes_threshold(chunks)


def _merge_unique(primary: list[RetrievedChunk], extra: list[RetrievedChunk]) -> list[RetrievedChunk]:
    seen = {c.chunk_id for c in primary}
    return primary + [c for c in extra if c.chunk_id not in seen]


def retrieve(query: StructuredQuery) -> tuple[list[RetrievedChunk], bool]:
    """Orquesta Tier 0/1/(2), rankea y evalúa el umbral. Devuelve (chunks, passed_threshold).

    El Tier 2 (vector) solo se dispara si el Tier 1 es débil; si Cohere no está disponible, se
    degrada con gracia al resultado del Tier 1 (no rompe el camino determinístico)."""
    filters = tier0_filters(query)
    chunks = rank_chunks(tier1_lexical_glossary(query, filters), filters)
    if _is_weak(chunks):
        try:
            extra = tier2_vector_fallback(query, filters)
            chunks = rank_chunks(_merge_unique(chunks, extra), filters)
        except EmbeddingError:
            pass  # sin Cohere: nos quedamos con el Tier 1
    return chunks, passes_threshold(chunks)


def fuse_context(literature: list[RetrievedChunk], patient: PatientContext) -> dict:
    """Une literatura (global) + contexto del paciente (por clínica) EN MEMORIA, en zonas
    separadas. Nunca en la DB, nunca por JOIN. Expone las alergias severas para el gate."""
    return {
        "literature": literature,
        "patient": patient,
        "severe_allergies": list(patient.severe_allergies),
    }
