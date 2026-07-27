"""Memoria semántica del paciente (`patient_embeddings`): que Athos RECUERDE la historia.

Hasta ahora `load_patient_context` devolvía `history_snippets=[]` fijo y la tabla estaba vacía: el
copiloto solo veía la ficha estructurada (especie, peso, alergias, medicación) y no tenía ni idea
de lo que se habló en consultas anteriores. Acá se indexan las notas clínicas APROBADAS y las
transcripciones del paciente y se recuperan por similitud con la consulta actual.

Aislamiento (regla 6/7 del servicio): el corpus es global, esto es POR CLÍNICA. `service_role` se
salta RLS, así que TODA query filtra por `clinic_id` Y `patient_id` explícitos. Nunca se hace JOIN
entre corpus y datos de paciente: son caminos separados que se fusionan en memoria.

Mismo modelo y dimensión que el corpus (Cohere embed-v4, 1024): cambiar de modelo obliga a
re-embeddizar todo.
"""
from app.db import execute, fetch_all
from app.embeddings import EmbeddingClient, EmbeddingError

# Notas y transcripciones pueden ser largas; el embedding se queda con lo útil.
MAX_CHARS = 6000
DEFAULT_SNIPPETS = 5


def _vector_literal(v) -> str:
    return "[" + ",".join(f"{x:.7f}" for x in v) + "]"


def _fuentes_pendientes(clinic_id: str, patient_id: str) -> list[dict]:
    """Notas aprobadas + transcripciones del paciente que aún no están embeddizadas.

    Solo notas revisadas por un humano (`approved`/`locked` del enum note_status): un `draft` es
    salida cruda del modelo y no debe volverse memoria: se realimentaría su propio error.
    """
    notas = fetch_all(
        "select n.id as source_id, 'clinical_note' as source_type, "
        "  concat_ws(E'\\n', n.subjective, n.objective, n.assessment, n.plan) as content "
        "from public.clinical_notes n "
        "join public.consultations c on c.id = n.consultation_id and c.clinic_id = n.clinic_id "
        "where n.clinic_id = %s and c.patient_id = %s and n.status in ('approved','locked') "
        "  and not exists (select 1 from public.patient_embeddings e "
        "                  where e.clinic_id = n.clinic_id and e.source_id = n.id "
        "                    and e.source_type = 'clinical_note')",
        (clinic_id, patient_id),
    )
    trans = fetch_all(
        "select t.id as source_id, 'transcript' as source_type, t.full_text as content "
        "from public.transcripts t "
        "join public.consultations c on c.id = t.consultation_id and c.clinic_id = t.clinic_id "
        "where t.clinic_id = %s and c.patient_id = %s and t.full_text is not null "
        "  and not exists (select 1 from public.patient_embeddings e "
        "                  where e.clinic_id = t.clinic_id and e.source_id = t.id "
        "                    and e.source_type = 'transcript')",
        (clinic_id, patient_id),
    )
    return [r for r in (notas + trans) if (r.get("content") or "").strip()]


def index_patient_memory(clinic_id: str, patient_id: str) -> int:
    """Embeddiza lo que falte de este paciente. Idempotente. Devuelve cuántas filas agregó.

    Ante un fallo de Cohere no revienta: la memoria es una mejora, no un requisito del chat.
    """
    pendientes = _fuentes_pendientes(clinic_id, patient_id)
    if not pendientes:
        return 0
    textos = [(r["content"] or "")[:MAX_CHARS] for r in pendientes]
    try:
        vectores = EmbeddingClient().embed(textos, input_type="search_document")
    except EmbeddingError:
        return 0
    for r, v in zip(pendientes, vectores):
        execute(
            "insert into public.patient_embeddings "
            "  (clinic_id, patient_id, source_type, source_id, content, embedding) "
            "values (%s,%s,%s,%s,%s,%s::vector)",
            (clinic_id, patient_id, r["source_type"], r["source_id"],
             (r["content"] or "")[:MAX_CHARS], _vector_literal(v)),
        )
    return len(pendientes)


def search_patient_memory(clinic_id: str, patient_id: str, query_vector,
                          limit: int = DEFAULT_SNIPPETS) -> list[str]:
    """Trozos de la historia del paciente más parecidos a la consulta actual.

    Recibe el vector YA calculado: el Tier 2 de la cascada ya embeddiza la consulta y lo cachea, así
    que recordar la historia no cuesta una llamada extra a Cohere ni suma latencia de red.
    """
    if not query_vector:
        return []
    emb = _vector_literal(query_vector)
    rows = fetch_all(
        "select content from public.patient_embeddings "
        "where clinic_id = %s and patient_id = %s and embedding is not null "
        "order by embedding <=> %s::vector limit %s",
        (clinic_id, patient_id, emb, limit),
    )
    return [r["content"] for r in rows if r.get("content")]


def recall(clinic_id: str, patient_id: str, question: str,
           limit: int = DEFAULT_SNIPPETS) -> list[str]:
    """Memoria del paciente para esta consulta, SIN costo extra de embedding.

    Se llama DESPUÉS del retrieval a propósito: el Tier 2 ya embeddizó la consulta y la dejó en la
    caché LRU de la cascada, así que acá el vector sale de memoria. Si Cohere no estuvo disponible
    (el Tier 2 degradó), no hay vector y simplemente no hay memoria semántica: nunca se paga una
    segunda llamada ni se suma latencia al chat.
    """
    try:
        from app.retrieval.cascade import _query_vector_cached
        vector = list(_query_vector_cached((question or "").strip()))
    except Exception:  # noqa: BLE001 — sin Cohere no hay memoria semántica; el chat sigue igual
        return []
    try:
        return search_patient_memory(clinic_id, patient_id, vector, limit)
    except Exception:  # noqa: BLE001
        return []
