"""Resolución de conceptos: el corazón del puente ES->EN (parte determinística del paso A->B)."""
import re
import unicodedata

from app.db import fetch_all_corpus
from app.models import StructuredQuery


def _normalize(text: str) -> str:
    """minúsculas, sin acentos, sin puntuación, espacios colapsados (comparación estable ES/EN)."""
    t = unicodedata.normalize("NFKD", text.lower())
    t = "".join(c for c in t if not unicodedata.combining(c))  # quita acentos (ñ -> n)
    t = re.sub(r"[^a-z0-9 ]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def match_concepts(text: str, species: str | None, synonyms: list[dict]) -> StructuredQuery:
    """Resuelve texto (ES/EN) a conceptos canónicos usando `synonyms` (cada uno con 'syn'
    normalizado, 'canonical_en' y 'mesh'). Determinístico, sin IA: coincidencia por palabra/frase
    completa. Devuelve una StructuredQuery lista para la cascada (concepts + mesh para el Tier 1)."""
    hay = f" {_normalize(text)} "
    concepts: list[str] = []
    mesh: list[str] = []
    for s in synonyms:
        syn = s.get("syn")
        if syn and f" {syn} " in hay:
            concepts.append(s["canonical_en"])
            if s.get("mesh"):
                mesh.append(s["mesh"])
    return StructuredQuery(
        concepts=list(dict.fromkeys(concepts)),
        mesh=list(dict.fromkeys(mesh)),
        species=species,
        language="en",
        raw=text,
    )


def _load_approved_synonyms() -> list[dict]:
    """Carga los sinónimos `approved` del glosario (join con su término)."""
    rows = fetch_all_corpus(
        "select s.text syn, t.canonical_en, coalesce(t.mesh_id, t.canonical_en) mesh "
        "from public.glossary_synonym s join public.glossary_term t on t.id = s.term_id "
        "where s.review_status = 'approved'"
    )
    return [
        {"syn": _normalize(r["syn"]), "canonical_en": r["canonical_en"], "mesh": r["mesh"]}
        for r in rows
    ]


def resolve_concepts(text: str, species: str | None) -> StructuredQuery:
    """Mapea las palabras del vet/dueño (ES) a conceptos canónicos.

    Busca en glossary_synonym (solo `approved`) -> resuelve glossary_term -> junta canonical_en y
    mesh. Devuelve una StructuredQuery. Sin IA, sin tokens.
    """
    return match_concepts(text, species, _load_approved_synonyms())
