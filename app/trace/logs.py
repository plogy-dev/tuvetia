"""Trazabilidad del RAG (por clínica, RLS). Se conserva con la historia clínica (permanente)."""
import json
from app.db import fetch_all


def log_message(clinic_id: str, user_id: str | None, patient_id: str | None,
                role: str, content: str) -> str:
    rows = fetch_all(
        "insert into public.athos_messages (clinic_id, user_id, patient_id, role, content) "
        "values (%s,%s,%s,%s,%s) returning id",
        (clinic_id, user_id, patient_id, role, content),
    )
    return rows[0]["id"]


def log_retrieval(clinic_id: str, source: str, query_used: str, concepts: list[str],
                  chunk_ids: list[str], top_score: float, passed: bool,
                  user_id: str | None = None, patient_id: str | None = None) -> str:
    rows = fetch_all(
        "insert into public.rag_retrieval_log "
        "(clinic_id, user_id, patient_id, source, query_used, concepts, chunk_ids, top_score, passed_threshold) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s,%s) returning id",
        (clinic_id, user_id, patient_id, source, query_used, concepts, chunk_ids, top_score, passed),
    )
    return rows[0]["id"]


def log_answer(clinic_id: str, retrieval_id: str | None, note_id: str | None, answer: str,
               citations: list[dict], insufficient: bool, severe_allergy: bool, model: str) -> str:
    rows = fetch_all(
        "insert into public.rag_answer_log "
        "(clinic_id, retrieval_id, note_id, answer, citations, insufficient_evidence, severe_allergy_flagged, model) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s) returning id",
        (clinic_id, retrieval_id, note_id, answer, json.dumps(citations), insufficient, severe_allergy, model),
    )
    return rows[0]["id"]
