"""Alertas de condición: detección determinística desde el assessment (sin IA ni DB)."""
from app.generation.condition_alerts import detect_conditions


def test_detecta_diabetes_desde_el_assessment():
    a = detect_conditions("El cuadro es compatible con diabetes mellitus en un perro adulto.")
    assert [x.condition for x in a] == ["Diabetes mellitus"]
    assert a[0].mesh == "Diabetes Mellitus"
    assert a[0].severity == "warning" and a[0].source == "assessment"
    assert a[0].detail is None            # el panel por paciente se llena con IA aparte


def test_tolera_acentos_y_frases():
    """Normaliza acentos: 'enfermedad renal crónica' se detecta pese a la tilde."""
    a = detect_conditions("Hallazgos compatibles con enfermedad renal crónica (ERC).")
    assert [x.condition for x in a] == ["Enfermedad renal crónica"]


def test_multiples_condiciones_en_orden_sin_duplicados():
    a = detect_conditions("Sospecha de diabetes mellitus con dermatitis atópica secundaria; "
                          "también otitis externa. Reitera diabetes.")
    labels = [x.condition for x in a]
    assert labels == ["Diabetes mellitus", "Dermatitis atópica", "Otitis externa"]  # orden CONDITIONS, sin dup


def test_sin_condicion_no_alerta():
    assert detect_conditions("Cuadro inespecífico; se recomienda valorar exámenes.") == []
    assert detect_conditions("") == []
