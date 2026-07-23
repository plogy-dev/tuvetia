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
    return str(rows[0]["id"])


def load_thread(clinic_id: str, patient_id: str, limit: int = 8) -> list[dict]:
    """Carga los últimos `limit` mensajes (user/assistant) del hilo del paciente, del más antiguo al
    más reciente, para dar MEMORIA al chat. El hilo es implícito por (clinic_id, patient_id): no hay
    thread_id en `athos_messages`. `clinic_id` explícito (service_role se salta RLS)."""
    rows = fetch_all(
        "select role, content from public.athos_messages "
        "where clinic_id = %s and patient_id = %s and role in ('user','assistant') "
        "order by created_at desc limit %s",
        (clinic_id, patient_id, limit),
    )
    return list(reversed(rows))  # oldest -> newest


def log_retrieval(clinic_id: str, source: str, query_used: str, concepts: list[str],
                  chunk_ids: list[str], top_score: float, passed: bool,
                  user_id: str | None = None, patient_id: str | None = None) -> str:
    # chunk_ids -> literal de array casteado a uuid[] (evita el mismatch text[] vs uuid[]).
    chunk_arr = "{" + ",".join(str(c) for c in chunk_ids) + "}"
    rows = fetch_all(
        "insert into public.rag_retrieval_log "
        "(clinic_id, user_id, patient_id, source, query_used, concepts, chunk_ids, top_score, passed_threshold) "
        "values (%s,%s,%s,%s,%s,%s,%s::uuid[],%s,%s) returning id",
        (clinic_id, user_id, patient_id, source, query_used, concepts, chunk_arr, top_score, passed),
    )
    return str(rows[0]["id"])


def log_answer(clinic_id: str, retrieval_id: str | None, note_id: str | None, answer: str,
               citations: list[dict], insufficient: bool, severe_allergy: bool, model: str) -> str:
    rows = fetch_all(
        "insert into public.rag_answer_log "
        "(clinic_id, retrieval_id, note_id, answer, citations, insufficient_evidence, severe_allergy_flagged, model) "
        "values (%s,%s,%s,%s,%s,%s,%s,%s) returning id",
        (clinic_id, retrieval_id, note_id, answer, json.dumps(citations), insufficient, severe_allergy, model),
    )
    return str(rows[0]["id"])
