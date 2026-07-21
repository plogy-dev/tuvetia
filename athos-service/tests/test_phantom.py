"""Orquestación del Modo Fantasma (`suggest`): fija las reglas del contrato sin depender de DB ni LLM.

- El gate DURO (desde `allergies`, no el modelo) fluye a la respuesta Y a la nota.
- `insufficient_evidence = not passed` (umbral de la cascada).
- NO se pasa literatura a la redacción cuando no se supera el umbral (nota del transcript sin citas).
- Las citas verificadas se propagan a `clinical_notes` (nota autocontenida para el revisor).

Test unitario puro: mockea todo el I/O (loaders, cascada, gate, generación, inserción, trazas).
La lógica del gate contra la DB real ya está cubierta en test_allergy_gate/test_cross_tenant.
"""
import app.phantom as phantom
from app.models import SOAP, Citation, PatientContext, RetrievedChunk, StructuredQuery


def _patch_common(monkeypatch, *, passed: bool, captured: dict) -> None:
    """Mockea el I/O de suggest(); captura lo que reciben generate_note e _insert_note."""
    monkeypatch.setattr(phantom, "_load_consultation",
                        lambda c, cid: {"patient_id": "luna", "chief_complaint": "vomita hace 2 dias"})
    monkeypatch.setattr(phantom, "_load_transcript", lambda c, cid: None)
    monkeypatch.setattr(phantom, "load_patient_context",
                        lambda c, p: PatientContext(patient_id="luna", species="perro",
                                                    severe_allergies=["pollo"]))
    monkeypatch.setattr(phantom, "build_query",
                        lambda text, sp: StructuredQuery(raw=text, concepts=["Vomiting"], species=sp))
    chunk = RetrievedChunk(chunk_id="c1", doc_id="PM1", content="feline gastritis ...", score=0.9)
    monkeypatch.setattr(phantom, "retrieve",
                        lambda q: ([chunk], True) if passed else ([], False))
    # gate DURO: Luna tiene alergia severa -> True (contra DB se prueba en test_allergy_gate)
    monkeypatch.setattr(phantom, "evaluate_gate", lambda c, p: (True, ["pollo"]))

    def fake_generate_note(transcript, literature, patient, severe):
        captured["gen_literature"] = literature
        return (
            SOAP(subjective="vomita", objective="TPR normal",
                 assessment="compatible con gastritis", plan="dieta blanda"),
            [Citation(chunk_id="c1", doc_id="PM1", locator="Results", source="PubMed")],
            False,
        )
    monkeypatch.setattr(phantom, "generate_note", fake_generate_note)

    def fake_insert_note(clinic_id, consultation_id, transcript_id, soap, citations,
                         gate_triggered, model, ai_at):
        captured["note_citations"] = citations
        captured["note_gate"] = gate_triggered
        return "note-xyz"
    monkeypatch.setattr(phantom, "_insert_note", fake_insert_note)
    monkeypatch.setattr(phantom, "log_retrieval", lambda *a, **k: "ret-1")
    monkeypatch.setattr(phantom, "log_answer", lambda *a, **k: None)


def test_suggest_gate_and_citations_flow(monkeypatch):
    """passed=True: gate a la respuesta y a la nota; citas propagadas; sin insuficiencia."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)

    resp = phantom.suggest("cons-1", "clinic-a")

    assert resp.allergy_gate_triggered is True            # gate DURO -> respuesta
    assert captured["note_gate"] is True                  # ...y persistido en la nota
    assert resp.insufficient_evidence is False            # passed=True
    assert [c.chunk_id for c in resp.citations] == ["c1"]
    assert [c.chunk_id for c in captured["note_citations"]] == ["c1"]  # citas -> clinical_notes
    assert resp.note_id == "note-xyz"
    assert resp.status == "draft"


def test_suggest_passed_pero_sin_citas_es_insuficiente(monkeypatch):
    """passed=True pero el modelo no ancló NINGUNA cita (literatura irrelevante) -> el payload es
    honesto: insufficient_evidence=True y citations=[]. Evita 'evidencia suficiente' con 0 citas."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)

    def _gen_sin_citas(transcript, literature, patient, severe):
        return (SOAP(assessment="no hay evidencia específica en la literatura"), [], False)

    monkeypatch.setattr(phantom, "generate_note", _gen_sin_citas)

    resp = phantom.suggest("cons-1", "clinic-a")

    assert resp.insufficient_evidence is True   # passed pero sin citas -> insuficiente
    assert resp.citations == []
    assert resp.allergy_gate_triggered is True  # el gate sigue siendo independiente


def test_suggest_insufficient_evidence_sends_no_literature(monkeypatch):
    """passed=False: se marca insuficiencia y NO se pasa literatura a la redacción."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=False, captured=captured)

    resp = phantom.suggest("cons-1", "clinic-a")

    assert resp.insufficient_evidence is True             # no supera el umbral
    assert captured["gen_literature"] == []               # regla: sin literatura si no pasa
    assert resp.allergy_gate_triggered is True            # el gate es independiente del umbral
