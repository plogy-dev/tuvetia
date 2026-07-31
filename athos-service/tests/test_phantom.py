"""Orquestación del Modo Fantasma (`suggest`): fija las reglas del contrato sin depender de DB ni LLM.

- El gate DURO (desde `allergies`, no el modelo) fluye a la respuesta Y a la nota.
- `insufficient_evidence = not passed` (umbral de la cascada).
- NO se pasa literatura a la redacción cuando no se supera el umbral (nota del transcript sin citas).
- Las citas verificadas se propagan a `clinical_notes` (nota autocontenida para el revisor).

Test unitario puro: mockea todo el I/O (loaders, cascada, gate, generación, inserción, trazas).
La lógica del gate contra la DB real ya está cubierta en test_allergy_gate/test_cross_tenant.
"""
import app.phantom as phantom
from fastapi import HTTPException
from app.generation.generate import EmptyNoteError
from app.generation.evidence_judge import EvidenceVerdict
from app.models import (EVIDENCE_LIMITED, EVIDENCE_NONE, EVIDENCE_SUFFICIENT, SOAP, Citation,
                        PatientContext, RetrievedChunk, StructuredQuery)


def _patch_common(monkeypatch, *, passed: bool, captured: dict) -> None:
    """Mockea el I/O de suggest(); captura lo que reciben generate_note e _insert_note."""
    monkeypatch.setattr(phantom, "_load_consultation",
                        lambda c, cid: {"patient_id": "luna", "chief_complaint": "vomita hace 2 dias"})
    monkeypatch.setattr(phantom, "_load_transcript", lambda c, cid: None)
    monkeypatch.setattr(phantom, "load_patient_context",
                        lambda c, p: PatientContext(patient_id="luna", species="perro",
                                                    severe_allergies=["pollo"]))
    chunk = RetrievedChunk(chunk_id="c1", doc_id="PM1", content="feline gastritis ...", score=0.9)
    monkeypatch.setattr(phantom, "build_and_retrieve", lambda text, sp: (
        StructuredQuery(raw=text, concepts=["Vomiting"], species=sp),
        [chunk] if passed else [], passed))
    # gate DURO: Luna tiene alergia severa -> True (contra DB se prueba en test_allergy_gate)
    monkeypatch.setattr(phantom, "evaluate_gate", lambda c, p: (True, ["pollo"]))

    def fake_generate_note(transcript, literature, patient, severe, **_kw):
        captured["gen_literature"] = literature
        return (
            SOAP(subjective="vomita", objective="TPR normal",
                 assessment="compatible con gastritis", plan="dieta blanda"),
            [Citation(chunk_id="c1", doc_id="PM1", locator="Results", source="PubMed")],
            False,
        )
    monkeypatch.setattr(phantom, "generate_note", fake_generate_note)

    def fake_insert_note(clinic_id, consultation_id, transcript_id, soap, citations,
                         gate_triggered, model, ai_at, alerts, evidence_level):
        captured["note_citations"] = citations
        captured["note_gate"] = gate_triggered
        captured["note_alerts"] = alerts
        captured["note_evidence_level"] = evidence_level
        return "note-xyz"
    monkeypatch.setattr(phantom, "_insert_note", fake_insert_note)
    monkeypatch.setattr(phantom, "log_retrieval", lambda *a, **k: "ret-1")
    monkeypatch.setattr(phantom, "log_answer", lambda *a, **k: None)
    # Juez de evidencia: por defecto "sí cubre" (los tests que miden la abstención lo re-parchean).
    monkeypatch.setattr(phantom, "judge_evidence", lambda q, chunks, **kw: EvidenceVerdict(
        band=EVIDENCE_SUFFICIENT, score=8.0, judged=True))


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


def test_suggest_persiste_alertas_de_condicion(monkeypatch):
    """Las alertas de condición detectadas en el assessment se propagan a _insert_note (persistencia
    en la nota) y también al payload."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)

    def _gen_diabetes(transcript, literature, patient, severe, **_kw):
        return (SOAP(assessment="cuadro compatible con diabetes mellitus"),
                [Citation(chunk_id="c1", doc_id="PM1")], False)

    monkeypatch.setattr(phantom, "generate_note", _gen_diabetes)
    # evita la llamada real del panel: identidad (deja las alertas tal como se detectan)
    monkeypatch.setattr(phantom, "explain_conditions", lambda alerts, patient, lit: alerts)

    resp = phantom.suggest("cons-1", "clinic-a")

    labels = [a.condition for a in captured["note_alerts"]]
    assert "Diabetes mellitus" in labels                        # detectada -> a la nota
    assert [a.condition for a in resp.alerts] == labels          # y al payload


def test_suggest_passed_pero_sin_citas_es_insuficiente(monkeypatch):
    """passed=True pero el modelo no ancló NINGUNA cita (literatura irrelevante) -> el payload es
    honesto: insufficient_evidence=True y citations=[]. Evita 'evidencia suficiente' con 0 citas."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)

    def _gen_sin_citas(transcript, literature, patient, severe, **_kw):
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
    assert resp.evidence_level == EVIDENCE_NONE
    assert captured["gen_literature"] == []               # regla: sin literatura si no pasa
    assert resp.allergy_gate_triggered is True            # el gate es independiente del umbral


# --- Abstención: el juez semántico (la señal que SÍ discrimina cobertura) ---

def test_suggest_juez_abstiene_no_manda_literatura(monkeypatch):
    """El umbral determinístico pasa (siempre pasa: 187/187 en el banco), pero el juez dictamina que
    los pasajes no sostienen el caso -> la nota se redacta SIN literatura, como si no hubiera."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)
    monkeypatch.setattr(phantom, "judge_evidence", lambda q, chunks, **kw: EvidenceVerdict(
        band=EVIDENCE_NONE, score=1.0, judged=True, reason="otra condición"))

    resp = phantom.suggest("cons-1", "clinic-a")

    assert captured["gen_literature"] == []                # no se redacta sobre literatura ajena
    assert resp.insufficient_evidence is True
    assert resp.evidence_level == EVIDENCE_NONE
    assert captured["note_evidence_level"] == EVIDENCE_NONE  # ...y queda en la nota (migración 0025)


def test_suggest_evidencia_limitada_responde_pero_lo_declara(monkeypatch):
    """Banda intermedia: SÍ se redacta con literatura (no es abstención), pero el payload y la nota
    declaran que la evidencia es limitada."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)
    monkeypatch.setattr(phantom, "judge_evidence", lambda q, chunks, **kw: EvidenceVerdict(
        band=EVIDENCE_LIMITED, score=4.0, judged=True))

    resp = phantom.suggest("cons-1", "clinic-a")

    assert [c.chunk_id for c in captured["gen_literature"]] == ["c1"]   # se redacta con literatura
    assert resp.insufficient_evidence is False
    assert resp.evidence_level == EVIDENCE_LIMITED
    assert captured["note_evidence_level"] == EVIDENCE_LIMITED


def test_suggest_nivel_reportado_es_el_efectivo(monkeypatch):
    """El juez puntúa alto pero la redacción no ancló ninguna cita: la nota NO tiene respaldo, así
    que el nivel reportado cae a `none` (coherente con insufficient_evidence)."""
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)
    monkeypatch.setattr(phantom, "generate_note",
                        lambda t, lit, p, s, **_kw: (SOAP(assessment="sin respaldo"), [], False))

    resp = phantom.suggest("cons-1", "clinic-a")

    assert resp.insufficient_evidence is True
    assert resp.evidence_level == EVIDENCE_NONE


def test_suggest_no_inserta_nota_cuando_la_generacion_falla(monkeypatch):
    """Si el modelo no devuelve una nota utilizable, NO se crea la fila en `clinical_notes`.

    Una nota en blanco en la historia clinica es peor que un error: el veterinario no puede
    distinguirla de "no habia nada que decir" y queda un borrador fantasma colgado de la consulta.
    """
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)

    def revienta(*a, **k):
        raise EmptyNoteError("el modelo no devolvio una nota SOAP utilizable en 2 intentos")

    monkeypatch.setattr(phantom, "generate_note", revienta)

    def no_insertar(*a, **k):
        raise AssertionError("se inserto una nota a pesar de que la generacion fallo")

    monkeypatch.setattr(phantom, "_insert_note", no_insertar)

    try:
        phantom.suggest("cons-1", "clinic-a")
    except HTTPException as e:
        assert e.status_code == 502
    else:
        raise AssertionError("suggest() no propago el fallo de generacion como HTTPException")


def test_suggest_marca_las_cifras_sin_citar_del_analisis_y_el_plan(monkeypatch):
    """El analisis y el plan tambien se revisan: `citation_fidelity` solo alcanza a las frases CON
    cita, y quedaba afuera lo ejecutable sin citar.

    Medido sobre 40 notas: el plan afirmaba cifras de incidencia como "vomitos (6.3% de los casos con
    fluralaner)" sin ninguna fuente detras. No se censura: se marca para que el vet lo revise.
    """
    captured: dict = {}
    _patch_common(monkeypatch, passed=True, captured=captured)

    def _gen(*a, **k):
        return (SOAP(subjective="", objective="",
                     assessment="El cuadro es compatible con dermatitis por pulgas.",
                     plan="Se observan vomitos en 6.3% de los casos tratados con fluralaner."),
                [], False)

    monkeypatch.setattr(phantom, "generate_note", _gen)
    resp = phantom.suggest("cons-1", "clinic-a")

    ap = [u for u in resp.unsupported_claims if u.get("section") == "A/P"]
    assert ap, "la cifra sin citar del plan deberia quedar marcada para revision"
    assert "6.3" in ap[0]["text"]
    # Y el SOAP NO se toca: es una historia clinica, no se reescribe por un veredicto.
    assert "6.3" in resp.soap.plan
