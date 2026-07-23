"""Alertas de condición: detección determinística + panel explicativo (LLM mockeado)."""
import app.generation.llm_client as llm
from app.generation.condition_alerts import detect_conditions, explain_conditions
from app.models import ConditionAlert, PatientContext, RetrievedChunk


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


# --- Panel explicativo (explain_conditions) ---

def _lit():
    return [RetrievedChunk(chunk_id="c1", doc_id="D1", content="canine diabetes ...", source="PubMed")]


def _patient():
    return PatientContext(patient_id="max", species="perro", weight_kg=22.0, age_years=8.0)


def test_explain_rellena_detail_desde_el_llm(monkeypatch):
    canned = '{"detalles": {"Diabetes mellitus": "En Max (canino, 22 kg) conviene vigilar la glucemia."}}'
    monkeypatch.setattr(llm.LLMClient, "complete", lambda self, s, u, max_tokens=800: canned)
    alerts = [ConditionAlert(condition="Diabetes mellitus")]
    out = explain_conditions(alerts, _patient(), _lit())
    assert out[0].detail.startswith("En Max")


def test_explain_sin_literatura_no_llama_al_llm(monkeypatch):
    """Sin literatura (abstención) no se explica ni se llama al LLM: cita o se calla."""
    llamado = {"n": 0}
    monkeypatch.setattr(llm.LLMClient, "complete",
                        lambda self, s, u, max_tokens=800: llamado.update(n=llamado["n"] + 1) or "{}")
    alerts = [ConditionAlert(condition="Diabetes mellitus")]
    out = explain_conditions(alerts, _patient(), literature=[])
    assert out[0].detail is None and llamado["n"] == 0


def test_explain_degrada_si_el_llm_falla(monkeypatch):
    """Cualquier fallo del LLM (sin crédito, timeout) -> alertas sin detail, sin romper."""
    def _boom(self, s, u, max_tokens=800):
        raise RuntimeError("sin credito")

    monkeypatch.setattr(llm.LLMClient, "complete", _boom)
    alerts = [ConditionAlert(condition="Diabetes mellitus")]
    out = explain_conditions(alerts, _patient(), _lit())
    assert out[0].detail is None
