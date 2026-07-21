"""A->B: la resolución por glosario NO usa IA (determinística, testeable sin DB).

Incluye el respaldo con LLM liviano (build_query): cuando el glosario queda pobre, distila la
consulta y fusiona (aditivo). El LLM se mockea; la lógica de fusión/gating es determinística.
"""
import app.retrieval.query_builder as qb
from app.glossary.resolve import _normalize, match_concepts
from app.models import StructuredQuery
from app.retrieval.query_builder import build_query

# Sinónimos en memoria (como los que devolvería el glosario `approved`), ya normalizados.
SYNS = [
    {"syn": _normalize("vomita"), "canonical_en": "Vomiting", "mesh": "Vomiting"},
    {"syn": _normalize("vómito"), "canonical_en": "Vomiting", "mesh": "Vomiting"},
    {"syn": _normalize("no come"), "canonical_en": "Anorexia", "mesh": "Anorexia"},
    {"syn": _normalize("tos"), "canonical_en": "Cough", "mesh": "Cough"},
]


def test_normalize_quita_acentos_y_puntuacion():
    assert _normalize("VÓMITO, agudo!") == "vomito agudo"
    assert _normalize("  Piel   Roja  ") == "piel roja"


def test_resolucion_es_a_conceptos():
    """'mi perro vomita' -> concepto canónico de vómito (EN) vía glosario."""
    q = match_concepts("mi perro vomita mucho", "perro", SYNS)
    assert "Vomiting" in q.concepts
    assert "Vomiting" in q.mesh   # el mesh alimenta el Tier 1 de la cascada
    assert q.species == "perro"
    assert q.language == "en"


def test_frase_coloquial_resuelve():
    q = match_concepts("el gato no come desde ayer", "gato", SYNS)
    assert q.concepts == ["Anorexia"]


def test_sin_coincidencia_concepts_vacio():
    q = match_concepts("consulta de control de rutina", None, SYNS)
    assert q.concepts == []
    assert q.mesh == []


def test_no_hay_falsos_positivos_por_subcadena():
    # 'tos' no debe dispararse dentro de otra palabra (p.ej. 'costoso')
    q = match_concepts("un tratamiento costoso", None, SYNS)
    assert "Cough" not in q.concepts


# --- Respaldo con LLM liviano (build_query) ---

def test_build_query_glosario_suficiente_no_distila(monkeypatch):
    """Si el glosario ya resuelve >= MIN_CONFIDENT_CONCEPTS, NO se llama al LLM (mínima IA)."""
    rico = StructuredQuery(concepts=["A", "B", "C", "D"], mesh=["A"], species="gato", raw="x")
    monkeypatch.setattr(qb, "resolve_concepts", lambda t, s: rico)
    llamado = {"n": 0}

    def _spy(t, s):
        llamado["n"] += 1
        return ["X"], ["X"]

    monkeypatch.setattr(qb, "distill_query", _spy)
    q = build_query("...", "gato")
    assert llamado["n"] == 0
    assert q.distilled is False
    assert q.concepts == ["A", "B", "C", "D"]


def test_build_query_glosario_pobre_distila_y_fusiona(monkeypatch):
    """Glosario pobre -> distila con el LLM liviano y FUSIONA (aditivo); marca distilled=True."""
    pobre = StructuredQuery(concepts=["Vomiting"], mesh=["Vomiting"], species="gato", raw="x")
    monkeypatch.setattr(qb, "resolve_concepts", lambda t, s: pobre)
    monkeypatch.setattr(qb, "distill_query",
                        lambda t, s: (["chronic kidney disease", "polyuria"],
                                      ["Renal Insufficiency, Chronic", "Cats"]))
    q = build_query("gato viejo toma mucha agua", "gato")
    assert q.distilled is True
    assert "Vomiting" in q.concepts and "chronic kidney disease" in q.concepts  # no reemplaza
    assert "Renal Insufficiency, Chronic" in q.mesh
    assert q.species == "gato"


def test_build_query_distill_vacio_degrada(monkeypatch):
    """Si el LLM liviano no aporta nada, se queda con el glosario (distilled=False)."""
    pobre = StructuredQuery(concepts=["Vomiting"], mesh=["Vomiting"], raw="x")
    monkeypatch.setattr(qb, "resolve_concepts", lambda t, s: pobre)
    monkeypatch.setattr(qb, "distill_query", lambda t, s: ([], []))
    q = build_query("...", None)
    assert q.distilled is False
    assert q.concepts == ["Vomiting"]


def test_distill_query_parsea_json(monkeypatch):
    """distill_query traduce la consulta a (concepts, mesh) leyendo el JSON del LLM liviano."""
    import app.generation.llm_client as llm
    canned = '{"concepts": ["chronic kidney disease"], "mesh": ["Renal Insufficiency, Chronic", "Cats"]}'
    monkeypatch.setattr(llm.LLMClient, "complete", lambda self, s, u, max_tokens=400: canned)
    concepts, mesh = qb.distill_query("gato viejo", "gato")
    assert concepts == ["chronic kidney disease"]
    assert "Cats" in mesh


def test_distill_query_degrada_si_llm_falla(monkeypatch):
    """Cualquier fallo del LLM liviano -> ([], []): el A->B nunca se rompe por el respaldo."""
    import app.generation.llm_client as llm

    def _boom(self, s, u, max_tokens=400):
        raise RuntimeError("sin api")

    monkeypatch.setattr(llm.LLMClient, "complete", _boom)
    assert qb.distill_query("x", None) == ([], [])
