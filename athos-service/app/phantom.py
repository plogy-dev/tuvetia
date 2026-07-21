"""Modo Fantasma (sección de integración): al cerrar la consulta, Athos genera la nota SOAP citada.

Orquesta el contrato `POST /athos/phantom/suggest`: carga transcript + contexto de paciente (por
clínica), corre la cascada, aplica el gate DURO de alergia (desde `allergies`, no el modelo),
genera la nota en UNA sola llamada, verifica citas, inserta `clinical_notes` (draft) y la
trazabilidad, y devuelve el payload. `clinic_id` siempre explícito (service_role se salta RLS).
"""
from datetime import datetime, timezone

from fastapi import HTTPException
from psycopg.types.json import Json

from app.config import get_settings
from app.db import fetch_all, get_conn
from app.generation.allergy_gate import evaluate_gate
from app.generation.generate import generate_note
from app.models import PhantomSuggestResponse
from app.patient_context import load_patient_context
from app.retrieval.cascade import retrieve
from app.retrieval.query_builder import build_query
from app.trace.logs import log_answer, log_retrieval


def _load_consultation(clinic_id: str, consultation_id: str) -> dict | None:
    rows = fetch_all(
        "select patient_id, chief_complaint from public.consultations "
        "where clinic_id = %s and id = %s",
        (clinic_id, consultation_id),
    )
    return rows[0] if rows else None


def _load_transcript(clinic_id: str, consultation_id: str) -> dict | None:
    rows = fetch_all(
        "select id, full_text from public.transcripts "
        "where clinic_id = %s and consultation_id = %s order by created_at desc limit 1",
        (clinic_id, consultation_id),
    )
    return rows[0] if rows else None


def _insert_note(clinic_id, consultation_id, transcript_id, soap, citations,
                 gate_triggered, model, ai_at) -> str:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into public.clinical_notes "
            "(clinic_id, consultation_id, transcript_id, status, subjective, objective, assessment, "
            " plan, citations, ai_generated_at, ai_model, allergy_gate_triggered) "
            "values (%s,%s,%s,'draft',%s,%s,%s,%s,%s,%s,%s,%s) returning id",
            (clinic_id, consultation_id, transcript_id, soap.subjective, soap.objective,
             soap.assessment, soap.plan, Json([c.model_dump() for c in citations]),
             ai_at, model, gate_triggered),
        )
        note_id = cur.fetchone()["id"]
        conn.commit()
    return str(note_id)


def suggest(consultation_id: str, clinic_id: str, user_id: str | None = None) -> PhantomSuggestResponse:
    """Genera la sugerencia del Modo Fantasma para una consulta. Devuelve el contrato cerrado."""
    cons = _load_consultation(clinic_id, consultation_id)
    if not cons:
        raise HTTPException(status_code=404, detail="consulta no encontrada en esta clínica")
    patient_id = str(cons["patient_id"])
    tr = _load_transcript(clinic_id, consultation_id)
    transcript_text = (tr["full_text"] if tr and tr["full_text"] else "") or (cons["chief_complaint"] or "")
    transcript_id = str(tr["id"]) if tr else None

    patient = load_patient_context(clinic_id, patient_id)

    # A->B (glosario + LLM liviano de respaldo) + cascada
    query = build_query(transcript_text, patient.species)
    chunks, passed = retrieve(query)

    # Gate DURO desde `allergies` (no el modelo)
    gate_triggered, severe = evaluate_gate(clinic_id, patient_id)

    # B->A: sin evidencia suficiente -> nota del transcript SIN literatura (insufficient_evidence)
    literature = chunks if passed else []
    soap, citations, allergy_flag = generate_note(transcript_text, literature, patient, severe)
    # Honestidad del payload: aunque el retrieval pase el umbral, si la generación no ancló NINGUNA
    # cita (la literatura recuperada no sustentaba el caso), no afirmamos evidencia suficiente. Así
    # el flag es consistente con la nota (citations=[] <-> insufficient_evidence=True).
    insufficient = not passed or not citations
    model = get_settings().llm_model
    ai_at = datetime.now(timezone.utc)

    # Trazabilidad
    retrieval_id = log_retrieval(
        clinic_id, "phantom", (query.raw or "")[:1000], list(query.concepts),
        [c.chunk_id for c in chunks], max((c.score for c in chunks), default=0.0), passed,
        user_id=user_id, patient_id=patient_id,
    )
    note_id = _insert_note(clinic_id, consultation_id, transcript_id, soap, citations,
                           gate_triggered, model, ai_at)
    soap_text = f"S: {soap.subjective}\nO: {soap.objective}\nA: {soap.assessment}\nP: {soap.plan}"
    log_answer(clinic_id, retrieval_id, note_id, soap_text,
               [c.model_dump() for c in citations], insufficient, gate_triggered, model)

    return PhantomSuggestResponse(
        note_id=note_id, status="draft", soap=soap,
        allergy_gate_triggered=gate_triggered, allergy_transcript_flag=allergy_flag,
        insufficient_evidence=insufficient, citations=citations,
        ai_model=model, ai_generated_at=ai_at,
    )
