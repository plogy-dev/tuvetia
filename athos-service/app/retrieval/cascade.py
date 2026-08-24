"""Cascada de recuperación (secciones 11.1-11.5). Núcleo determinístico: testeable sin IA.

Tier 0 filtros/boosts -> Tier 1 léxico+glosario -> (Tier 2 vector solo si Tier 1 es débil) ->
umbral -> fusión de contexto. El corpus es global; el contexto del paciente va por su propio
camino (RLS por clinic_id) y se fusiona EN MEMORIA. Nunca JOIN entre zonas.
"""
import logging
import unicodedata
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache

from app.db import fetch_all_corpus
from app.embeddings import EmbeddingError
from app.models import PatientContext, RetrievedChunk, StructuredQuery
from app.retrieval.query_builder import build_query
from app.retrieval.rerank import rerank_chunks

log = logging.getLogger(__name__)

# --- Parámetros determinísticos (se calibran con el golden set; arrancan conservadores) ---
THRESHOLD = 0.35        # score del mejor chunk para NO abstenerse
SPECIES_BOOST = 0.15    # preferencia por especie (NO exclusión)
CURRENT_BOOST = 0.05    # documento vigente (is_current)
CONCEPT_BOOST = 0.05    # por cada coincidencia de MeSH/concepto (tope 3)
TIER_BOOST = {"A": 0.05, "B": 0.02, "C": 0.0}

# Penalización por ALCANCE off-domain (2026-08-21). El corpus incorporó literatura de
# producción/granja/equino (`alcance=tier2_produccion`) y no-clínica (`otros_no_clinico`) del
# lote nuevo. Athos es un asistente de MASCOTAS: esos documentos no deben competir de igual a igual
# con la literatura companion en una consulta de perro/gato. La penalización es SUAVE, no exclusión:
# un doc de producción sigue apareciendo si es lo único que hay (p. ej. un fármaco transversal a
# especies), pero queda por debajo de cualquier evidencia companion comparable. Los documentos SIN
# `alcance` (el corpus PubMed original, ya orientado a mascotas) y los `companion` no se penalizan.
# Magnitud comparable a SPECIES_BOOST; PENDIENTE calibrar contra un golden ampliado con casos de
# producción antes de endurecerla.
ALCANCE_PENALTY = {"tier2_produccion": -0.15, "otros_no_clinico": -0.15}

# Bases de relevancia del Tier 1 (señales binarias fuertes, luego se afinan con boosts del Tier 0).
TIER1_MESH_BASE = 0.6   # el chunk trae un MeSH/concepto de la consulta: evidencia fuerte
TIER1_LEX_BASE = 0.4    # match de full-text (léxico)
TIER1_LIMIT = 40        # candidatos que trae el Tier 1
TIER2_LIMIT = 40        # candidatos que trae el Tier 2 (vector)
QUERY_EMBED_TIMEOUT_S = 6.0  # tope al embed de la consulta: si Cohere está lento (p.ej. key
                             # saturada por la ingesta), degradamos a Tier 1 en ~6s, no 60s
WEAK_MIN_RESULTS = 3    # menos candidatos que esto (o no pasar umbral) dispara el Tier 2

# Composición del set final (acota el costo de la generación y GARANTIZA representación de ambas
# modalidades: los matches léxicos/MeSH incidentales no deben sepultar los semánticos, que suelen
# ser los relevantes cuando el glosario ancló en una señal secundaria).
TIER1_KEEP = 24         # léxicos/MeSH que se conservan
TIER2_KEEP = 16         # semánticos (vector) que se conservan siempre que el Tier 2 corra
MAX_LITERATURE_CHUNKS = TIER1_KEEP + TIER2_KEEP  # tope de chunks que van a la generación

# Tras el rerank el set final es más chico Y más limpio: un cross-encoder sobre los 40 candidatos
# deja arriba lo que de verdad habla de la consulta. Medido en el golden ampliado (146 casos), sin
# rerank la precision@15 es ~19%. Si el rerank no está disponible se conservan los 40 de siempre.
RERANK_KEEP = 15

# Especie (ES, de la ficha) -> descriptores MeSH del corpus. 'mixto' no mapea: no se excluye.
# La ficha y la tool del agente de Next aceptan especie como TEXTO LIBRE ("Canino", "hurón"...):
# se normaliza (minúsculas, sin acentos) y se contemplan los sinónimos habituales, porque un
# valor que no mapea pierde la preferencia EN SILENCIO — no hay error que lo delate.
SPECIES_MESH = {
    "gato": ["Cats", "Cat Diseases"],
    "felino": ["Cats", "Cat Diseases"],
    "perro": ["Dogs", "Dog Diseases"],
    "canino": ["Dogs", "Dog Diseases"],
    "ave": ["Birds", "Bird Diseases"],
    "pajaro": ["Birds", "Bird Diseases"],
    "conejo": ["Rabbits"],
    "reptil": ["Reptiles"],
    "roedor": ["Rodentia", "Rodent Diseases"],
    "huron": ["Ferrets"],
}


def _normalize_species(species: str | None) -> str | None:
    """"Hurón"/"Canino" -> "huron"/"canino": minúsculas y sin marcas diacríticas."""
    if not species:
        return None
    plano = unicodedata.normalize("NFKD", species.strip().lower())
    return "".join(ch for ch in plano if not unicodedata.combining(ch)) or None

# idioma de la consulta -> config de full-text. El corpus está en inglés.
_TS_CONFIG = {"en": "english", "es": "spanish", "pt": "portuguese"}

# Descriptores que NO sirven para BUSCAR ni para puntuar: no dicen de qué trata el documento.
# La especie entra como PREFERENCIA (boost en `score_chunk` vía `preferred_species_mesh`), nunca
# como criterio temático. Dos problemas medidos que esto resuelve:
#   - `Dogs` está en 43.033 de los 520k chunks: si el A->B lo agrega (el prompt de distilación pide
#     la especie como MeSH), la rama MeSH del Tier 1 pasa a 43k filas y revienta el statement_timeout.
#   - contaba como "evidencia temática" para el umbral, que es una de las razones por las que
#     `passes_threshold` daba True en 187/187 casos (ver docs de la abstención).
TIER1_MESH_STOPLIST = frozenset({
    "Animals", "Animals, Domestic", "Pets", "Humans", "Female", "Male",
    "Dogs", "Cats", "Birds", "Rabbits", "Reptiles", "Rodentia", "Ferrets", "Horses", "Swine",
    "Dog Diseases", "Cat Diseases", "Bird Diseases", "Rodent Diseases", "Horse Diseases",
    "Swine Diseases", "Rabbit Diseases",
})


def tier0_filters(query: StructuredQuery) -> dict:
    """Filtros/boosts determinísticos (no tocan la DB). Especie = PREFERENCIA, no exclusión
    (se apoya en MeSH Cats/Dogs); idioma, is_current, tier y conceptos/MeSH para el ranking."""
    species = _normalize_species(query.species)
    return {
        "species": species,
        "preferred_species_mesh": SPECIES_MESH.get(species or "", []),
        "language": query.language,
        "require_is_current": True,
        "concepts": list(query.concepts),
        # Sin los descriptores de especie/estructurales: acá se decide TEMA, no a qué animal
        # pertenece el paper. La especie sigue viva como preferencia (preferred_species_mesh).
        "mesh": [m for m in query.mesh if m not in TIER1_MESH_STOPLIST],
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
    score += ALCANCE_PENALTY.get(str(md.get("alcance", "")), 0.0)
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


# Tope de filas que se rankean en la rama SOLO-full-text. Esa rama es el relleno: sólo aporta
# cuando el MeSH devuelve menos de TIER1_LIMIT. Sin tope, rankear sus decenas de miles de matches
# costaba más que todo el resto de la cascada junta.
TIER1_FTS_SCAN_CAP = 3000
# Respaldo por si un descriptor legítimo resulta enorme: acota cuántas filas se rankean en la rama
# MeSH. Con la stoplist, una consulta normal trae 1-3k; esto sólo actúa en la cola larga.
TIER1_MESH_SCAN_CAP = 20000

# Constante (y no inline) para que `scripts/calidad/latencia_db.py` mida EXACTAMENTE lo que corre en
# producción: si el SQL vive en dos lugares, la medición miente en cuanto uno de los dos cambie.
TIER1_SQL = (
    "with por_mesh as ("
    "  select id, source, title, content, metadata, true as mesh_hit, "
    "         ts_rank_cd(tsv, websearch_to_tsquery(%s, %s)) as lex "
    "  from (select id, source, title, content, metadata, tsv from public.corpus_chunks "
    "        where metadata->'mesh' ?| %s limit %s) c "
    "  order by lex desc limit %s"
    "), por_texto as ("
    "  select id, source, title, content, metadata, false as mesh_hit, "
    "         ts_rank_cd(tsv, websearch_to_tsquery(%s, %s)) as lex "
    "  from (select id, source, title, content, metadata, tsv from public.corpus_chunks "
    "        where tsv @@ websearch_to_tsquery(%s, %s) and not (metadata->'mesh' ?| %s) "
    "        limit %s) c "
    "  order by lex desc limit %s"
    ") select * from (select * from por_mesh union all select * from por_texto) u "
    "order by mesh_hit desc, lex desc limit %s"
)


def tier1_params(cfg: str, terms: str, mesh: list[str]) -> tuple:
    """Parámetros posicionales de TIER1_SQL (el orden importa y se repite: se arma en un solo sitio)."""
    return (cfg, terms, mesh, TIER1_MESH_SCAN_CAP, TIER1_LIMIT,
            cfg, terms, cfg, terms, mesh, TIER1_FTS_SCAN_CAP, TIER1_LIMIT,
            TIER1_LIMIT)


# Las dos ramas del Tier 1 por SEPARADO, para correr la full-text SÓLO si hace falta (ver
# `tier1_lexical_glossary`). La rama MeSH usa el índice GIN y es barata; la full-text, para signos
# comunes (fever, lethargy), hace un bitmap-heap-scan de decenas de miles de chunks (~19s en Micro).
TIER1_MESH_SQL = (
    "select id, source, title, content, metadata, true as mesh_hit, "
    "       ts_rank_cd(tsv, websearch_to_tsquery(%s, %s)) as lex "
    "from (select id, source, title, content, metadata, tsv from public.corpus_chunks "
    "      where metadata->'mesh' ?| %s limit %s) c "
    "order by lex desc limit %s"
)
TIER1_FTS_SQL = (
    "select id, source, title, content, metadata, false as mesh_hit, "
    "       ts_rank_cd(tsv, websearch_to_tsquery(%s, %s)) as lex "
    "from (select id, source, title, content, metadata, tsv from public.corpus_chunks "
    "      where tsv @@ websearch_to_tsquery(%s, %s) and not (metadata->'mesh' ?| %s) "
    "      limit %s) c "
    "order by lex desc limit %s"
)


def tier1_lexical_glossary(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Léxico + glosario (gratis): full-text (config del idioma) sobre content + match de
    conceptos/MeSH contra metadata->'mesh'. Base = 0.6 (MeSH) + 0.4 (léxico). Usa la DB.

    Las dos ramas van SEPARADAS a propósito. La versión con `where mesh ?| ... or tsv @@ ...`
    tardaba **15 segundos de servidor** sobre el corpus de 520k (medido 2026-07-28, al filo del
    `statement_timeout` de 15s: en producción se cancelaban consultas). El motivo: el `or` obliga a
    traer al heap TODOS los matches de ambas ramas —1.692 por MeSH y 17.147 por full-text en una
    consulta típica— y a calcular `ts_rank_cd` sobre los ~19k antes del LIMIT, cuando el orden
    primario (`mesh_hit desc`) garantiza que los de MeSH van primero igual.

    Separadas, sólo se rankea la rama que puede quedar arriba: **42 ms, mismos 40 chunks** (347x).
    """
    concepts = filters.get("concepts") or list(query.concepts)
    # OJO con `or`: si la stoplist deja la lista VACÍA (la consulta sólo traía especie), un `or`
    # volvería a la lista sin filtrar y anularía el filtro justo en el caso que más importa.
    mesh = filters["mesh"] if "mesh" in filters else list(query.mesh)
    cfg = _ts_config(filters.get("language"))
    terms = " or ".join(concepts)  # websearch_to_tsquery entiende OR
    # Rama MeSH primero. El sort final del union era `mesh_hit desc, lex desc`, así que las filas
    # MeSH SIEMPRE ganan las de full-text: si el MeSH ya llenó TIER1_LIMIT, las de full-text quedaban
    # descartadas por el orden — pero igual se computaban, y esa rama es la CARA (bitmap-heap-scan de
    # ~27k chunks para signos comunes, ~19s en Micro). Se corre SÓLO si el MeSH no llenó el cupo. El
    # resultado es idéntico al union anterior; lo que cambia es no pagar 19s cuando no aportan.
    rows = fetch_all_corpus(TIER1_MESH_SQL, (cfg, terms, mesh, TIER1_MESH_SCAN_CAP, TIER1_LIMIT))
    if len(rows) < TIER1_LIMIT:
        fts = fetch_all_corpus(
            TIER1_FTS_SQL, (cfg, terms, cfg, terms, mesh, TIER1_FTS_SCAN_CAP, TIER1_LIMIT))
        # Replica exactamente el `union all ... order by mesh_hit desc, lex desc limit N` del original.
        rows = sorted(rows + fts, key=lambda r: (r["mesh_hit"], float(r["lex"] or 0.0)),
                      reverse=True)[:TIER1_LIMIT]
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
    rows = fetch_all_corpus(
        "select id, source, title, content, metadata, 1 - (embedding <=> %s::vector) as sim "
        "from public.corpus_chunks where embedding is not null "
        "order by embedding <=> %s::vector limit %s",
        (emb, emb, limit),
    )
    return [_to_chunk(r, float(r["sim"])) for r in rows]


@lru_cache(maxsize=256)
def _query_vector_cached(text: str) -> tuple[float, ...]:
    """Vector search_query de la consulta, con caché LRU: reintentos del vet y preguntas
    frecuentes idénticas no pagan Cohere (latencia + costo) otra vez. Los errores NO se cachean."""
    from app.embeddings import EmbeddingClient
    client = EmbeddingClient(timeout_s=QUERY_EMBED_TIMEOUT_S)
    return tuple(client.embed([text], input_type="search_query")[0])


def vector_candidates(text: str) -> list[RetrievedChunk]:
    """Tier 2 crudo: embeddiza el TEXTO (Cohere, input_type=search_query) y busca sobre el corpus.

    Depende del texto, NO de los conceptos: por eso puede arrancar antes de que el A->B termine
    (ver `build_and_retrieve`). Timeout corto: si Cohere no responde en QUERY_EMBED_TIMEOUT_S sube
    EmbeddingError y la cascada se queda con el Tier 1 (el chat nunca espera un embed lento)."""
    vector = list(_query_vector_cached(text.strip() or text))
    return _vector_search(vector, TIER2_LIMIT)


def tier2_vector_fallback(query: StructuredQuery, filters: dict) -> list[RetrievedChunk]:
    """Complemento semántico sobre una consulta ya construida."""
    return vector_candidates(query.raw)


def _is_weak(chunks: list[RetrievedChunk]) -> bool:
    return len(chunks) < WEAK_MIN_RESULTS or not passes_threshold(chunks)


def _should_run_tier2(query: StructuredQuery, tier1: list[RetrievedChunk]) -> bool:
    """El Tier 2 (vector) corre SIEMPRE, como COMPLEMENTO semántico del Tier 1 (no solo fallback).

    Calibración 2026-07-22 (golden con DeepSeek): el Tier 1 léxico/MeSH puede ser *fuerte pero
    off-topic* — los signos incidentales del cuadro (p.ej. vómito/diarrea) + el MeSH de especie
    sepultan la literatura de la condición real (hipertiroidismo felino: 0/8 chunks de tiroides en el
    top del Tier 1, 8/8 en el Tier 2). Correr el Tier 2 siempre y fusionar ambas modalidades subió el
    golden de 10/11 a 11/11 estable. Es una embedding de Cohere por consulta (~US$0,0006): trivial
    frente a la ganancia de calidad. (`_is_weak`/`distilled` quedan como señales históricas; ya no
    cambian el resultado, pero documentan cuándo el Tier 1 es dudoso.)"""
    return True


def _merge_unique(primary: list[RetrievedChunk], extra: list[RetrievedChunk]) -> list[RetrievedChunk]:
    seen = {c.chunk_id for c in primary}
    return primary + [c for c in extra if c.chunk_id not in seen]


def _fusionar(query: StructuredQuery, filters: dict, tier1: list[RetrievedChunk],
              tier2: list[RetrievedChunk] | None) -> tuple[list[RetrievedChunk], bool]:
    """Fusiona ambas modalidades, evalúa el umbral y reordena. Conserva un tope de CADA una (léxico
    + semántico) para que los buenos matches semánticos no queden sepultados por matches léxicos o
    de MeSH incidentales."""
    if tier2 is not None and _should_run_tier2(query, tier1):
        chunks = rank_chunks(_merge_unique(tier1[:TIER1_KEEP], tier2[:TIER2_KEEP]), filters)
    else:
        chunks = tier1[:MAX_LITERATURE_CHUNKS]
    # El umbral se evalúa ANTES del rerank, sobre el score determinístico: activar el reranker
    # cambia QUÉ literatura llega a la generación, nunca cuándo Athos se abstiene.
    passed = passes_threshold(chunks)
    chunks, _ = rerank_chunks(query.raw, chunks, RERANK_KEEP)
    return chunks, passed


def retrieve(query: StructuredQuery) -> tuple[list[RetrievedChunk], bool]:
    """Orquesta Tier 0/1/2 sobre una consulta YA construida. Devuelve (chunks, passed_threshold).

    Tier 1 (query al corpus) y Tier 2 (embed de Cohere + query vectorial) corren EN PARALELO: antes
    iban encadenados y la latencia de Cohere se SUMABA a la del Tier 1 en cada request. Si Cohere no
    está disponible o está lento (timeout corto), degrada con gracia al Tier 1.

    Para el camino completo desde el texto del vet usa `build_and_retrieve`, que además solapa el
    Tier 2 con el A->B."""
    filters = tier0_filters(query)
    with ThreadPoolExecutor(max_workers=2) as ex:
        f_tier1 = ex.submit(lambda: rank_chunks(tier1_lexical_glossary(query, filters), filters))
        f_tier2 = ex.submit(lambda: rank_chunks(tier2_vector_fallback(query, filters), filters))
        tier1 = f_tier1.result()
        tier2: list[RetrievedChunk] | None
        try:
            tier2 = f_tier2.result()
        except EmbeddingError:
            tier2 = None  # sin Cohere (o lento): nos quedamos con el Tier 1
    return _fusionar(query, filters, tier1, tier2)


def build_and_retrieve(text: str, species: str | None) -> tuple[StructuredQuery, list[RetrievedChunk], bool]:
    """A->B + recuperación, con el Tier 2 SOLAPADO sobre la construcción de la consulta.

    El Tier 2 embebe el TEXTO CRUDO del vet: no necesita los conceptos, así que no tiene por qué
    esperar al A->B. Antes se pagaba en serie —distilación con el LLM liviano (~4,3s medidos) y
    recién después el retrieval (~4,4s)—; ahora el embed y la búsqueda vectorial se cocinan MIENTRAS
    el LLM interpreta el cuadro. En las consultas que distilan (la mayoría: el glosario no cubre
    todo el lenguaje del dueño) el ahorro es de varios segundos hasta el primer token.

    Devuelve también la `StructuredQuery` porque el llamador la necesita para la traza.
    """
    with ThreadPoolExecutor(max_workers=1) as ex:
        f_tier2 = ex.submit(vector_candidates, text)
        query = build_query(text, species)          # glosario (+ LLM liviano si hace falta)
        filters = tier0_filters(query)
        tier1 = rank_chunks(tier1_lexical_glossary(query, filters), filters)
        try:
            tier2 = rank_chunks(f_tier2.result(), filters)
        except EmbeddingError:
            tier2 = None
        except Exception as e:  # noqa: BLE001 — el Tier 2 nunca tumba el camino determinístico
            log.warning("cascada: el Tier 2 solapado falló (%s); se sigue con el Tier 1", e)
            tier2 = None
    chunks, passed = _fusionar(query, filters, tier1, tier2)
    return query, chunks, passed


def fuse_context(literature: list[RetrievedChunk], patient: PatientContext) -> dict:
    """Une literatura (global) + contexto del paciente (por clínica) EN MEMORIA, en zonas
    separadas. Nunca en la DB, nunca por JOIN. Expone las alergias severas para el gate."""
    return {
        "literature": literature,
        "patient": patient,
        "severe_allergies": list(patient.severe_allergies),
    }
