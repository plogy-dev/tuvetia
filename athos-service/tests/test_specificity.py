"""Especificidad MeSH: distinguir una CONDICIÓN concreta de un signo inespecífico.

Es lo que decide si el A->B necesita que el LLM interprete el cuadro. El dato sale del árbol MeSH
(rama C23 = signos y síntomas), generado por scripts/calidad/mesh_especificidad_generar.py.
"""
from app.glossary.specificity import diagnostic_descriptors, names_a_condition

SIGNOS = ["Vomiting", "Diarrhea", "Fever", "Lethargy", "Cough", "Anorexia", "Pruritus",
          "Weight Loss", "Hemorrhage", "Abdominal Pain", "Polydipsia"]
CONDICIONES = ["Babesiosis", "Distemper", "Ehrlichiosis", "Giardiasis", "Pyometra", "Rabies",
               "Leishmaniasis", "Dirofilariasis", "Parvoviridae Infections", "Lymphoma",
               "Hyperthyroidism", "Diabetes Mellitus", "Sporotrichosis", "Coccidiosis"]


def test_el_dato_existe_y_tiene_volumen_razonable():
    d = diagnostic_descriptors()
    assert 800 < len(d) < 2000, f"conteo inesperado de descriptores diagnosticos: {len(d)}"


def test_los_signos_no_son_diagnostico():
    d = diagnostic_descriptors()
    assert [s for s in SIGNOS if s in d] == []


def test_las_condiciones_si_son_diagnostico():
    d = diagnostic_descriptors()
    assert [c for c in CONDICIONES if c not in d] == []


def test_names_a_condition_basta_con_una():
    assert names_a_condition(["Vomiting", "Fever", "Babesiosis"]) is True


def test_names_a_condition_solo_signos_es_false():
    """Aunque sean muchos: contar signos no equivale a entender el cuadro."""
    assert names_a_condition(["Polydipsia", "Polyuria", "Weight Loss", "Vomiting"]) is False


def test_names_a_condition_vacio():
    assert names_a_condition([]) is False


def test_farmacos_y_procedimientos_no_cuentan_como_diagnostico():
    """Un fármaco acompaña al cuadro pero no lo nombra: no debe frenar la distilación."""
    d = diagnostic_descriptors()
    assert "Fenbendazole" not in d and "Permethrin" not in d
