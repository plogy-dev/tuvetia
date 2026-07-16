"""Siembra y curación del glosario (sección 8). El glosario es GLOBAL, activo de la plataforma.

- `seed_from_corpus_mesh`: siembra términos EN desde los descriptores MeSH del corpus (candidate).
- `seed_curated_glossary`: siembra un set inicial CURADO ES->EN (approved), con lenguaje coloquial.
- `seed_from_decs`: pendiente (requiere el dataset DeCS para sinónimos ES automáticos).
El retrieval usa por defecto solo sinónimos `approved`.

CLI:  uv run python -m app.glossary.seed
"""
from app.db import execute_corpus, fetch_all_corpus, get_corpus_conn

# Curación inicial: motivos de consulta frecuentes en clínica + coloquial del dueño (ES) -> MeSH (EN).
# Se siembran como `approved`. Ampliable con curación veterinaria.
CURATED = [
    {"canonical_en": "Vomiting", "mesh": "Vomiting", "category": "gastroenterologia",
     "es": ["vomito", "vomitar", "vomita", "arcadas", "devuelve la comida"]},
    {"canonical_en": "Diarrhea", "mesh": "Diarrhea", "category": "gastroenterologia",
     "es": ["diarrea", "heces blandas", "caca blanda", "descompuesto"]},
    {"canonical_en": "Anorexia", "mesh": "Anorexia", "category": "general",
     "es": ["anorexia", "no come", "inapetencia", "falta de apetito", "sin apetito"]},
    {"canonical_en": "Cough", "mesh": "Cough", "category": "respiratorio",
     "es": ["tos", "tose", "tosido"]},
    {"canonical_en": "Fever", "mesh": "Fever", "category": "general",
     "es": ["fiebre", "calentura", "temperatura alta"]},
    {"canonical_en": "Pruritus", "mesh": "Pruritus", "category": "dermatologia",
     "es": ["picazon", "comezon", "prurito", "se rasca", "rasca mucho"]},
    {"canonical_en": "Lameness, Animal", "mesh": "Lameness, Animal", "category": "traumatologia",
     "es": ["cojera", "cojea", "renquea", "no apoya la pata"]},
    {"canonical_en": "Seizures", "mesh": "Seizures", "category": "neurologia",
     "es": ["convulsion", "convulsiones", "ataques", "espasmos"]},
    {"canonical_en": "Lethargy", "mesh": "Lethargy", "category": "general",
     "es": ["letargo", "decaido", "apatico", "sin energia"]},
    {"canonical_en": "Dermatitis", "mesh": "Dermatitis", "category": "dermatologia",
     "es": ["dermatitis", "irritacion de piel", "sarpullido", "piel roja"]},
    {"canonical_en": "Weight Loss", "mesh": "Weight Loss", "category": "general",
     "es": ["perdida de peso", "adelgazo", "esta flaco", "bajo de peso"]},
    {"canonical_en": "Polydipsia", "mesh": "Polydipsia", "category": "endocrinologia",
     "es": ["toma mucha agua", "bebe mucha agua", "mucha sed", "polidipsia"]},
]


def seed_from_corpus_mesh() -> int:
    """Crea glossary_term/synonym (candidate, EN) desde los descriptores MeSH del corpus.
    Idempotente: salta descriptores que ya existan como canonical_en. Devuelve nº de términos nuevos."""
    rows = fetch_all_corpus(
        "select distinct jsonb_array_elements_text(metadata->'mesh') m "
        "from public.corpus_chunks where metadata ? 'mesh'"
    )
    descriptors = sorted({r["m"] for r in rows if r["m"]})
    existing = {r["canonical_en"] for r in
                fetch_all_corpus("select canonical_en from public.glossary_term")}
    created = 0
    with get_corpus_conn() as conn, conn.cursor() as cur:
        for d in descriptors:
            if d in existing:
                continue
            cur.execute(
                "insert into public.glossary_term (canonical_en, mesh_id, review_status) "
                "values (%s, %s, 'candidate') returning id",
                (d, d),
            )
            term_id = cur.fetchone()["id"]
            cur.execute(
                "insert into public.glossary_synonym (term_id, text, lang, origin, review_status) "
                "values (%s, %s, 'en', 'mesh_corpus', 'candidate')",
                (term_id, d),
            )
            created += 1
        conn.commit()
    return created


def seed_curated_glossary() -> int:
    """Siembra el set CURADO ES->EN como `approved` (crea término si falta, lo marca approved, y
    agrega sinónimos EN+ES). Idempotente. Devuelve nº de sinónimos nuevos."""
    created = 0
    with get_corpus_conn() as conn, conn.cursor() as cur:
        for item in CURATED:
            cur.execute(
                "select id from public.glossary_term where canonical_en = %s", (item["canonical_en"],)
            )
            row = cur.fetchone()
            if row:
                term_id = row["id"]
                cur.execute(
                    "update public.glossary_term set review_status = 'approved', "
                    "mesh_id = coalesce(mesh_id, %s), category = coalesce(category, %s) where id = %s",
                    (item["mesh"], item.get("category"), term_id),
                )
            else:
                cur.execute(
                    "insert into public.glossary_term (canonical_en, mesh_id, category, review_status) "
                    "values (%s, %s, %s, 'approved') returning id",
                    (item["canonical_en"], item["mesh"], item.get("category")),
                )
                term_id = cur.fetchone()["id"]
            synonyms = [(item["canonical_en"], "en")] + [(e, "es") for e in item["es"]]
            for text, lang in synonyms:
                cur.execute(
                    "select id, review_status from public.glossary_synonym "
                    "where term_id = %s and lower(text) = lower(%s)",
                    (term_id, text),
                )
                row = cur.fetchone()
                if row is None:
                    cur.execute(
                        "insert into public.glossary_synonym (term_id, text, lang, origin, review_status) "
                        "values (%s, %s, %s, 'curated', 'approved')",
                        (term_id, text, lang),
                    )
                    created += 1
                elif row["review_status"] != "approved":
                    # promueve un candidato existente (p.ej. sembrado desde el MeSH del corpus)
                    cur.execute(
                        "update public.glossary_synonym set review_status = 'approved', origin = 'curated' "
                        "where id = %s",
                        (row["id"],),
                    )
                    created += 1
        conn.commit()
    return created


def seed_from_decs() -> int:
    """Agrega sinónimos en español (DeCS) mapeados a los descriptores MeSH. Pendiente: requiere el
    dataset DeCS. Mientras tanto usamos `seed_curated_glossary` para el puente ES->EN."""
    raise NotImplementedError("sembrar sinónimos ES desde DeCS (falta el dataset DeCS)")


def approve_synonym(synonym_id: str, reviewer_id: str) -> None:
    """Marca un sinónimo como approved (curación veterinaria) y registra al revisor en el término."""
    execute_corpus(
        "update public.glossary_term t set reviewed_by = %s, reviewed_at = now() "
        "from public.glossary_synonym s where s.id = %s and s.term_id = t.id",
        (reviewer_id, synonym_id),
    )
    execute_corpus(
        "update public.glossary_synonym set review_status = 'approved' where id = %s", (synonym_id,)
    )


def seed_all() -> dict:
    """Siembra automática (corpus MeSH) + curación inicial ES->EN. Idempotente."""
    return {
        "mesh_terms_nuevos": seed_from_corpus_mesh(),
        "curated_synonyms_nuevos": seed_curated_glossary(),
    }


if __name__ == "__main__":
    print(seed_all())
