"""Cascada determinística (sin LLM): preferencia de especie, umbral, fusión de contexto."""
from app.models import RetrievedChunk, StructuredQuery, PatientContext
from app.retrieval.cascade import (
    tier0_filters, rank_chunks, passes_threshold, fuse_context, tier1_lexical_glossary, _vector_search,
)


def _chunk(cid: str, especie: str, mesh: list[str], score: float) -> RetrievedChunk:
    return RetrievedChunk(chunk_id=cid, doc_id=cid, content="...", score=score,
                          metadata={"especie": especie, "mesh": mesh, "is_current": True})


def test_especie_es_preferencia_no_exclusion():
    """Para un gato, el chunk felino rankea por encima del de ave, sin excluir 'mixto'."""
    chunks = [
        _chunk("felino", "gato", ["Cats", "Sporotrichosis"], 0.5),
        _chunk("ave", "ave", ["Birds"], 0.5),
        _chunk("mixto", "mixto", [], 0.5),
    ]
    ranked = rank_chunks(chunks, tier0_filters(StructuredQuery(species="gato", raw="micosis gato")))
    assert ranked[0].chunk_id == "felino"
    assert {c.chunk_id for c in ranked} == {"felino", "ave", "mixto"}  # nada se excluye


def test_umbral_se_abstiene_sin_evidencia():
    """Si el mejor score no supera el umbral, passes_threshold debe ser False."""
    filters = tier0_filters(StructuredQuery(species="gato"))
    assert passes_threshold([]) is False
    debil = rank_chunks([_chunk("d", "gato", [], 0.05)], filters)
    assert passes_threshold(debil) is False
    fuerte = rank_chunks([_chunk("f", "gato", ["Cats"], 0.9)], filters)
    assert passes_threshold(fuerte) is True


def test_fuse_context_separa_zonas():
    """La fusión mantiene literatura (global) y paciente (por clínica) en zonas separadas."""
    lit = [_chunk("c1", "gato", ["Cats"], 0.9)]
    pat = PatientContext(patient_id="luna", species="perro", severe_allergies=["pollo"])
    fused = fuse_context(lit, pat)
    assert fused["literature"] is lit
    assert fused["patient"].patient_id == "luna"
    assert fused["severe_allergies"] == ["pollo"]


def test_especie_no_entra_como_criterio_tematico():
    """`Dogs` (43.033 de 520k chunks) NO puede usarse para buscar: no dice de qué trata el paper,
    revienta el Tier 1 y encima contaba como 'evidencia temática' para el umbral. Sigue vivo como
    preferencia de especie."""
    from app.retrieval.cascade import TIER1_MESH_STOPLIST
    q = StructuredQuery(concepts=["Pain", "Dogs"], mesh=["Pain", "Dogs"], species="perro", raw="x")
    f = tier0_filters(q)
    assert "Dogs" not in f["mesh"] and "Pain" in f["mesh"]
    assert "Dogs" in f["preferred_species_mesh"]         # la especie sigue dando boost
    assert "Dog Diseases" in TIER1_MESH_STOPLIST


def test_solo_especie_deja_el_mesh_vacio_y_no_lo_repone():
    """Si la consulta SÓLO trajo especie, la lista de búsqueda queda vacía a propósito. Un `or` en
    el código la habría repuesto sin filtrar, anulando el filtro justo en el caso patológico."""
    q = StructuredQuery(concepts=["Dogs"], mesh=["Dogs"], species="perro", raw="x")
    f = tier0_filters(q)
    assert f["mesh"] == []


def test_especie_texto_libre_se_normaliza():
    """La ficha y la tool del agente mandan especie como texto libre ("Canino", "hurón"): sin
    normalización, la preferencia de especie se pierde EN SILENCIO (no hay error que lo delate)."""
    for valor, esperado in [("Canino", "Dogs"), ("FELINO", "Cats"), ("hurón", "Ferrets"),
                            ("  Pájaro ", "Birds"), ("perro", "Dogs")]:
        f = tier0_filters(StructuredQuery(species=valor))
        assert esperado in f["preferred_species_mesh"], valor


def test_especie_desconocida_no_excluye():
    """Una especie que no mapea ("mixto", "iguana") no filtra nada: preferencia vacía, sin error."""
    for valor in ("mixto", "iguana", "", None):
        f = tier0_filters(StructuredQuery(species=valor))
        assert f["preferred_species_mesh"] == []


def test_tier1_encuentra_por_mesh(require_db):
    """Tier 1 recupera chunks del corpus por descriptor MeSH (integración contra la DB)."""
    import pytest
    from app.db import fetch_all
    from app.retrieval.cascade import TIER1_MESH_STOPLIST
    # Un descriptor TEMÁTICO y acotado: los de especie están en la stoplist a propósito, y los
    # gigantes (decenas de miles de chunks) no prueban nada sobre el match por MeSH.
    row = fetch_all(
        "select x.m, count(*) n from public.corpus_chunks c, "
        "  jsonb_array_elements_text(c.metadata->'mesh') x(m) "
        "group by x.m having count(*) between 50 and 400 order by n desc limit 1"
    )
    if not row or not row[0]["m"] or row[0]["m"] in TIER1_MESH_STOPLIST:
        pytest.skip("corpus sin un descriptor tematico acotado")
    descriptor = row[0]["m"]
    q = StructuredQuery(concepts=[descriptor], mesh=[descriptor], raw=descriptor)
    chunks = tier1_lexical_glossary(q, tier0_filters(q))
    assert chunks
    assert any(descriptor in (c.metadata.get("mesh") or []) for c in chunks)


def test_tier2_vector_recupera_el_mismo_chunk(require_db):
    """El SQL del Tier 2 se valida reusando un embedding ya guardado (sin llamar a Cohere)."""
    import json
    import pytest
    from app.db import fetch_all
    row = fetch_all(
        "select id, embedding::text emb from public.corpus_chunks where embedding is not null limit 1"
    )
    if not row:
        pytest.skip("corpus sin embeddings")
    vec = json.loads(row[0]["emb"])
    res = _vector_search(vec, 3)
    assert res
    assert res[0].chunk_id == str(row[0]["id"])   # el vecino más cercano de un vector es él mismo
    assert res[0].score > 0.99


def test_tier2_dispara_si_distilled(monkeypatch):
    """Aunque el Tier 1 pase el umbral, si el A->B distiló (hueco de glosario) se corre el Tier 2 y
    se conservan resultados semánticos junto a los léxicos (que no los sepulten los incidentales)."""
    import app.retrieval.cascade as csc
    tier1 = [_chunk(f"t1_{i}", "gato", ["Cats", "Vomiting"], 0.9) for i in range(5)]
    tier2 = [_chunk(f"v_{i}", "gato", ["Renal Insufficiency, Chronic", "Cats"], 0.5) for i in range(5)]
    monkeypatch.setattr(csc, "tier1_lexical_glossary", lambda q, f: tier1)
    monkeypatch.setattr(csc, "tier2_vector_fallback", lambda q, f: tier2)
    q = StructuredQuery(concepts=["Vomiting"], mesh=["Vomiting"], species="gato", raw="x",
                        distilled=True)
    chunks, passed = csc.retrieve(q)
    ids = {c.chunk_id for c in chunks}
    assert any(i.startswith("v_") for i in ids)    # semánticos presentes pese a Tier 1 "fuerte"
    assert any(i.startswith("t1_") for i in ids)
    assert passed is True


def test_tier2_corre_siempre_como_complemento(monkeypatch):
    """Calibración 2026-07-22: el Tier 2 corre SIEMPRE (complemento semántico), incluso con Tier 1
    fuerte y sin distill — porque el Tier 1 puede ser *fuerte pero off-topic* (signos incidentales +
    especie sepultan la condición). Se conservan ambas modalidades."""
    import app.retrieval.cascade as csc
    tier1 = [_chunk(f"t1_{i}", "gato", ["Cats"], 0.9) for i in range(5)]
    tier2 = [_chunk(f"v_{i}", "gato", ["Hyperthyroidism", "Cats"], 0.5) for i in range(5)]
    monkeypatch.setattr(csc, "tier1_lexical_glossary", lambda q, f: tier1)
    llamado = {"n": 0}

    def _t2(q, f):
        llamado["n"] += 1
        return tier2

    monkeypatch.setattr(csc, "tier2_vector_fallback", _t2)
    q = StructuredQuery(concepts=["Cats"], mesh=["Cats"], raw="x", distilled=False)
    chunks, passed = csc.retrieve(q)
    ids = {c.chunk_id for c in chunks}
    assert llamado["n"] == 1                        # Tier 2 SÍ corre (complemento, no condicional)
    assert any(i.startswith("v_") for i in ids)     # semánticos presentes...
    assert any(i.startswith("t1_") for i in ids)    # ...junto a los léxicos
    assert passed is True


def test_build_and_retrieve_solapa_el_tier2_con_el_a2b(monkeypatch):
    """El Tier 2 embebe el TEXTO CRUDO, así que no tiene por qué esperar al A->B.

    La prueba es de concurrencia real: el A->B no devuelve hasta ver que el Tier 2 ya arrancó. Si
    volvieran a encadenarse (A->B y recién después el vector), este test se cuelga y falla."""
    import threading

    import app.retrieval.cascade as csc

    arranco_tier2 = threading.Event()
    tier2 = [_chunk("v_1", "gato", ["Hyperthyroidism", "Cats"], 0.5)]

    def _vector(text):
        arranco_tier2.set()
        return tier2

    def _build(text, species):
        # Si el Tier 2 estuviera detrás del A->B, esta espera vencería: siguen en serie.
        assert arranco_tier2.wait(5), "el Tier 2 NO arrancó durante el A->B: están encadenados"
        return StructuredQuery(concepts=["Vomiting"], mesh=["Vomiting"], species=species,
                               raw=text, distilled=True)

    monkeypatch.setattr(csc, "vector_candidates", _vector)
    monkeypatch.setattr(csc, "build_query", _build)
    monkeypatch.setattr(csc, "tier1_lexical_glossary",
                        lambda q, f: [_chunk("t1_1", "gato", ["Cats", "Vomiting"], 0.9)])

    query, chunks, passed = csc.build_and_retrieve("gata de 13 anios que adelgaza", "gato")

    ids = {c.chunk_id for c in chunks}
    assert ids == {"t1_1", "v_1"}          # ambas modalidades llegaron
    assert passed is True
    assert query.species == "gato"          # devuelve la query construida (la traza la necesita)


def test_build_and_retrieve_degrada_si_el_tier2_solapado_falla(monkeypatch):
    """El Tier 2 solapado tampoco puede tumbar el camino determinístico."""
    import app.retrieval.cascade as csc
    from app.embeddings import EmbeddingUnavailable

    def _boom(text):
        raise EmbeddingUnavailable("Cohere no respondió")

    monkeypatch.setattr(csc, "vector_candidates", _boom)
    monkeypatch.setattr(csc, "build_query",
                        lambda t, s: StructuredQuery(concepts=["Cats"], mesh=["Cats"], raw=t))
    monkeypatch.setattr(csc, "tier1_lexical_glossary",
                        lambda q, f: [_chunk("t1_1", "gato", ["Cats"], 0.9)])

    _, chunks, passed = csc.build_and_retrieve("x", "gato")

    assert [c.chunk_id for c in chunks] == ["t1_1"]
    assert passed is True


def test_retrieve_degrada_si_tier2_falla(monkeypatch):
    """Si el Tier 1 es débil y el Tier 2 no puede embeddizar (sin Cohere), retrieve NO rompe:
    se queda con el Tier 1 y se abstiene. Determinístico (sin DB ni red)."""
    import app.retrieval.cascade as csc
    from app.embeddings import EmbeddingQuotaExceeded
    monkeypatch.setattr(csc, "tier1_lexical_glossary", lambda q, f: [])

    def _boom(q, f):
        raise EmbeddingQuotaExceeded("trial agotada")

    monkeypatch.setattr(csc, "tier2_vector_fallback", _boom)
    chunks, passed = csc.retrieve(StructuredQuery(concepts=["x"], mesh=["x"], raw="x"))
    assert chunks == []
    assert passed is False


def test_retrieve_degrada_si_cohere_esta_lento(monkeypatch):
    """Cohere LENTO (timeout, p.ej. key saturada por la ingesta) tampoco rompe: el Tier 1 fuerte
    se sirve solo, sin esperar el embed. El chat responde con retrieval léxico."""
    import app.retrieval.cascade as csc
    from app.embeddings import EmbeddingUnavailable
    tier1 = [_chunk(f"t1_{i}", "gato", ["Cats", "Hyperthyroidism"], 0.9) for i in range(5)]
    monkeypatch.setattr(csc, "tier1_lexical_glossary", lambda q, f: tier1)

    def _timeout(q, f):
        raise EmbeddingUnavailable("Cohere no respondió (timeout/red)")

    monkeypatch.setattr(csc, "tier2_vector_fallback", _timeout)
    q = StructuredQuery(concepts=["Hyperthyroidism"], mesh=["Hyperthyroidism"], species="gato",
                        raw="hipertiroidismo gato")
    chunks, passed = csc.retrieve(q)
    assert [c.chunk_id for c in chunks] == [c.chunk_id for c in tier1]  # se queda con el Tier 1
    assert passed is True
