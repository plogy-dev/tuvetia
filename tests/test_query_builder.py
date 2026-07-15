"""A->B: la resolución por glosario NO usa IA (determinística, testeable sin DB)."""
from app.glossary.resolve import _normalize, match_concepts

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
