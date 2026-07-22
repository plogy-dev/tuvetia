"""Siembra y curación del glosario (sección 8). El glosario es GLOBAL, activo de la plataforma.

- `seed_from_corpus_mesh`: siembra términos EN desde los descriptores MeSH del corpus (candidate).
- `seed_curated_glossary`: siembra un set inicial CURADO ES->EN (approved), con lenguaje coloquial.
- `seed_from_decs`: pendiente (requiere el dataset DeCS para sinónimos ES automáticos).
El retrieval usa por defecto solo sinónimos `approved`.

CLI:  uv run python -m app.glossary.seed
"""
from app.db import execute_corpus, fetch_all_corpus, get_corpus_conn

# Curación inicial: motivos de consulta frecuentes en clínica + coloquial del dueño (ES) -> MeSH (EN).
# Se siembran como `approved`. Ampliable con curación veterinaria. Sinónimos como frase/palabra
# completa (el matcher es determinístico por límite de palabra): preferir frases específicas
# ("orina mucho") a palabras ambiguas ("orina") para no meter falsos positivos.
CURATED = [
    # --- Gastrointestinal ---
    {"canonical_en": "Vomiting", "mesh": "Vomiting", "category": "gastroenterologia",
     "es": ["vomito", "vomitar", "vomita", "vomitando", "arcadas", "devuelve la comida", "regurgita"]},
    {"canonical_en": "Diarrhea", "mesh": "Diarrhea", "category": "gastroenterologia",
     "es": ["diarrea", "diarrea liquida", "heces blandas", "caca blanda", "descompuesto",
            "deposiciones blandas"]},
    {"canonical_en": "Gastrointestinal Hemorrhage", "mesh": "Gastrointestinal Hemorrhage",
     "category": "gastroenterologia",
     "es": ["diarrea con sangre", "sangre en la diarrea", "heces con sangre", "sangre en las heces",
            "diarrea hemorragica", "melena", "heces negras"]},
    {"canonical_en": "Constipation", "mesh": "Constipation", "category": "gastroenterologia",
     "es": ["estrenido", "no hace caca", "no defeca", "no ha hecho caca", "ausencia de heces",
            "no ha hecho caquitas", "no puede defecar"]},
    {"canonical_en": "Abdominal Pain", "mesh": "Abdominal Pain", "category": "gastroenterologia",
     "es": ["dolor abdominal", "abdomen sensible", "le duele la barriga", "abdomen distendido",
            "vientre hinchado", "abdomen doloroso"]},
    {"canonical_en": "Anorexia", "mesh": "Anorexia", "category": "general",
     "es": ["anorexia", "no come", "no quiere comer", "no quiere comer nada", "inapetencia",
            "falta de apetito", "sin apetito", "casi no come"]},
    {"canonical_en": "Hyperphagia", "mesh": "Hyperphagia", "category": "general",
     "es": ["come mucho", "come muchisimo", "mucha hambre", "polifagia", "come con mucha hambre",
            "siempre tiene hambre", "come demasiado"]},

    # --- Generales / sistémicos ---
    {"canonical_en": "Fever", "mesh": "Fever", "category": "general",
     "es": ["fiebre", "calentura", "temperatura alta"]},
    {"canonical_en": "Lethargy", "mesh": "Lethargy", "category": "general",
     "es": ["letargo", "decaido", "apatico", "sin energia", "muy caido", "esta caido", "deprimido",
            "quietecito", "sin animo", "aletargado"]},
    {"canonical_en": "Weight Loss", "mesh": "Weight Loss", "category": "general",
     "es": ["perdida de peso", "adelgazo", "esta flaco", "bajo de peso", "bajando de peso",
            "ha bajado de peso", "mas flaca", "esta delgado", "adelgazando"]},
    {"canonical_en": "Dehydration", "mesh": "Dehydration", "category": "general",
     "es": ["deshidratado", "deshidratacion", "mucosas secas", "mucosas pegajosas"]},
    {"canonical_en": "Pallor", "mesh": "Pallor", "category": "general",
     "es": ["mucosas palidas", "encias palidas", "esta palido"]},
    {"canonical_en": "Lymphadenopathy", "mesh": "Lymphadenopathy", "category": "general",
     "es": ["ganglios aumentados", "ganglios inflamados", "ganglios grandes",
            "nodulos linfaticos aumentados"]},

    # --- Endocrino / urinario / oftalmo ---
    {"canonical_en": "Polydipsia", "mesh": "Polydipsia", "category": "endocrinologia",
     "es": ["toma mucha agua", "bebe mucha agua", "toma muchisima agua", "toma agua sin parar",
            "mucha sed", "polidipsia", "bebe sin parar", "toma bastante agua"]},
    {"canonical_en": "Polyuria", "mesh": "Polyuria", "category": "endocrinologia",
     "es": ["orina mucho", "orina muchisimo", "orina demasiado", "poliuria", "llena la caja de arena",
            "hace mucho pipi", "orina mas de lo normal"]},
    {"canonical_en": "Cataract", "mesh": "Cataract", "category": "oftalmologia",
     "es": ["cataratas", "vista nublada", "ojo opaco", "opacidad en el cristalino", "ojos nublados"]},

    # --- Respiratorio / cardíaco ---
    {"canonical_en": "Cough", "mesh": "Cough", "category": "respiratorio",
     "es": ["tos", "tose", "tosido", "tos seca", "tose de noche"]},
    {"canonical_en": "Dyspnea", "mesh": "Dyspnea", "category": "respiratorio",
     "es": ["respira agitado", "dificultad para respirar", "le cuesta respirar", "respiracion agitada",
            "ahogado", "se cansa rapido", "jadea"]},
    {"canonical_en": "Cyanosis", "mesh": "Cyanosis", "category": "respiratorio",
     "es": ["se pone morado", "encias azules", "mucosas azuladas", "lengua morada", "cianosis"]},
    {"canonical_en": "Tachycardia", "mesh": "Tachycardia", "category": "cardiologia",
     "es": ["taquicardia", "taquicardico", "corazon muy rapido", "late el corazon muy rapido",
            "pulso acelerado"]},
    {"canonical_en": "Heart Murmurs", "mesh": "Heart Murmurs", "category": "cardiologia",
     "es": ["soplo", "soplo cardiaco", "soplo sistolico"]},

    # --- Dermatología ---
    {"canonical_en": "Pruritus", "mesh": "Pruritus", "category": "dermatologia",
     "es": ["picazon", "comezon", "prurito", "se rasca", "rasca mucho", "rascandose",
            "se muerde las patas", "se lame las patas", "sacude la cabeza", "se rasca la oreja"]},
    {"canonical_en": "Dermatitis", "mesh": "Dermatitis", "category": "dermatologia",
     "es": ["dermatitis", "irritacion de piel", "sarpullido", "piel roja", "dermatitis exfoliativa"]},
    {"canonical_en": "Alopecia", "mesh": "Alopecia", "category": "dermatologia",
     "es": ["alopecia", "se le cae el pelo", "perdida de pelo", "peladuras", "sin pelo",
            "pelaje descuidado", "zonas sin pelo"]},
    {"canonical_en": "Erythema", "mesh": "Erythema", "category": "dermatologia",
     "es": ["eritema", "piel enrojecida", "enrojecimiento", "piel roja e irritada"]},

    # --- Odontología ---
    {"canonical_en": "Halitosis", "mesh": "Halitosis", "category": "odontologia",
     "es": ["mal aliento", "le huele feo la boca", "aliento raro", "mal olor de boca", "halitosis"]},
    {"canonical_en": "Dental Calculus", "mesh": "Dental Calculus", "category": "odontologia",
     "es": ["sarro", "calculo dental", "dientes con sarro", "tartaro"]},
    {"canonical_en": "Gingivitis", "mesh": "Gingivitis", "category": "odontologia",
     "es": ["gingivitis", "sangra la encia", "encias sangrantes", "encias rojas", "encias inflamadas"]},

    # --- Neurológico / traumatología ---
    {"canonical_en": "Seizures", "mesh": "Seizures", "category": "neurologia",
     "es": ["convulsion", "convulsiones", "ataques", "espasmos"]},
    {"canonical_en": "Lameness, Animal", "mesh": "Lameness, Animal", "category": "traumatologia",
     "es": ["cojera", "cojea", "renquea", "no apoya la pata", "camina mal", "cojeando"]},
    {"canonical_en": "Bruxism", "mesh": "Bruxism", "category": "general",
     "es": ["rechina los dientes", "rechinar los dientes", "cruje los dientes", "bruxismo"]},

    # --- Diagnósticos / síndromes frecuentes (puente ES->EN del criterio del vet) ---
    {"canonical_en": "Periodontitis", "mesh": "Periodontitis", "category": "odontologia",
     "es": ["enfermedad periodontal", "periodontitis", "enfermedad periodontal avanzada"]},
    {"canonical_en": "Renal Insufficiency, Chronic", "mesh": "Renal Insufficiency, Chronic",
     "category": "nefrologia",
     "es": ["enfermedad renal cronica", "insuficiencia renal cronica", "falla renal",
            "insuficiencia renal", "enfermedad renal"]},
    {"canonical_en": "Hyperthyroidism", "mesh": "Hyperthyroidism", "category": "endocrinologia",
     "es": ["hipertiroidismo", "hipertiroidismo felino", "tiroides alta"]},
    {"canonical_en": "Diabetes Mellitus", "mesh": "Diabetes Mellitus", "category": "endocrinologia",
     "es": ["diabetes", "diabetes mellitus", "azucar alta"]},
    {"canonical_en": "Mitral Valve Insufficiency", "mesh": "Mitral Valve Insufficiency",
     "category": "cardiologia",
     "es": ["enfermedad de la valvula mitral", "valvulopatia mitral", "insuficiencia mitral",
            "degeneracion mixomatosa mitral", "enfermedad degenerativa de la valvula mitral"]},
    {"canonical_en": "Leishmaniasis", "mesh": "Leishmaniasis", "category": "infectologia",
     "es": ["leishmaniasis", "leishmania", "leishmaniosis"]},
    {"canonical_en": "Parvoviridae Infections", "mesh": "Parvoviridae Infections",
     "category": "infectologia",
     "es": ["parvovirus", "parvovirosis", "parvo", "enteritis por parvovirus"]},
    {"canonical_en": "Dermatitis, Atopic", "mesh": "Dermatitis, Atopic", "category": "dermatologia",
     "es": ["dermatitis atopica", "atopia", "dermatitis alergica"]},
    {"canonical_en": "Otitis Externa", "mesh": "Otitis Externa", "category": "otologia",
     "es": ["otitis", "otitis externa", "infeccion de oido", "oido infectado", "huele feo el oido",
            "cera oscura", "secrecion ceruminosa"]},
    {"canonical_en": "Gastroenteritis", "mesh": "Gastroenteritis", "category": "gastroenterologia",
     "es": ["gastroenteritis", "gastroenteritis aguda"]},
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
