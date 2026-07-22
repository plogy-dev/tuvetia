"""Chat de Athos (SSE): el vet pregunta y Athos responde con literatura citada, en streaming.

Cascada A->B -> retrieve -> umbral -> (gate de alergia) -> B->A en streaming. Si el retrieval no
pasa el umbral, responde una plantilla SIN LLM ("cita o se calla"). Emite eventos SSE:
  {"type":"warning"|"token"|"done", ...}. `clinic_id` siempre explícito.
"""
import json
import re

from app.config import get_settings
from app.generation.allergy_gate import severe_allergies
from app.generation.generate import _MAX_CHUNK_CHARS
from app.generation.llm_client import LLMClient
from app.models import Citation
from app.patient_context import load_patient_context
from app.retrieval.cascade import retrieve
from app.retrieval.query_builder import build_query
from app.trace.logs import log_message, log_retrieval

CHAT_LIT_LIMIT = 12   # fuentes numeradas que se ofrecen al modelo (y de las que salen las citas)

CHAT_SYSTEM = (
    "Eres un asistente clínico veterinario. Responde SOLO con base en la LITERATURA entregada. "
    "Usa lenguaje de posibilidad ('compatible con', 'sugestivo de'); NUNCA des un diagnóstico "
    "definitivo. Cita cada afirmación clínica con el número de su fuente entre corchetes "
    "(p.ej. [1], [3]); usa SOLO los números de la LITERATURA entregada y cita ÚNICAMENTE las "
    "fuentes que realmente uses. Si no hay evidencia suficiente en la literatura, dilo con "
    "franqueza (sin citar). No propongas dosis si faltan especie, peso o edad. Si el paciente tiene "
    "alergias severas, adviértelo antes de un plan. Sé conciso y claro."
)


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


def _format_numbered(literature) -> str:
    """Presenta la literatura con referencias numeradas [1], [2]... (el modelo cita por número,
    más fiable que copiar chunk_id crudos). El índice mapea de vuelta al chunk en _cited_from_answer."""
    lines = []
    for i, c in enumerate(literature, 1):
        content = (c.content or "")[:_MAX_CHUNK_CHARS]
        lines.append(f"[{i}] fuente={c.source or '?'} loc={c.locator or '?'}\n{content}")
    return "\n\n".join(lines) if lines else "(sin literatura suficiente)"


def _cited_from_answer(answer: str, literature) -> list[Citation]:
    """Devuelve SOLO las citas que el modelo referenció por número [n] en la respuesta, en orden de
    aparición y sin duplicados. Si no referenció ninguna, la lista queda vacía (honesto)."""
    used: list[Citation] = []
    seen: set[int] = set()
    for m in re.findall(r"\[(\d+)\]", answer):
        i = int(m) - 1
        if 0 <= i < len(literature) and i not in seen:
            seen.add(i)
            c = literature[i]
            used.append(Citation(chunk_id=c.chunk_id, doc_id=c.doc_id, locator=c.locator,
                                 source=c.source))
    return used


def _chat_prompt(question: str, literature, patient, severe_allergens) -> str:
    ficha = (f"- especie: {patient.species or '?'}; peso: {patient.weight_kg or '?'} kg; "
             f"edad: {patient.age_years or '?'} años")
    alergias = ", ".join(severe_allergens) if severe_allergens else "ninguna conocida"
    return (
        "CONTEXTO DEL PACIENTE:\n"
        f"{ficha}\n"
        f"- alergias severas conocidas: {alergias}\n\n"
        f"PREGUNTA DEL VETERINARIO:\n{question.strip()}\n\n"
        "LITERATURA RECUPERADA (cita SOLO estas fuentes, por su número [n]):\n"
        f"{_format_numbered(literature)}"
    )


def stream_answer(question: str, patient_id: str, clinic_id: str, user_id: str | None = None):
    """Generador de eventos SSE para /athos/chat."""
    patient = load_patient_context(clinic_id, patient_id)
    query = build_query(question, patient.species)
    chunks, passed = retrieve(query)
    severe = severe_allergies(clinic_id, patient_id)
    gate = bool(severe)

    log_message(clinic_id, user_id, patient_id, "user", question)
    log_retrieval(clinic_id, "chat", (query.raw or "")[:1000], list(query.concepts),
                  [c.chunk_id for c in chunks], max((c.score for c in chunks), default=0.0), passed,
                  user_id=user_id, patient_id=patient_id)

    if gate:
        yield _sse({"type": "warning",
                    "text": f"Alergias severas del paciente: {', '.join(severe)}. "
                            "Tenlas en cuenta antes de cualquier plan."})

    if not passed:
        msg = ("No hay evidencia suficiente en la literatura disponible para responder esta "
               "consulta con seguridad.")
        yield _sse({"type": "token", "text": msg})
        log_message(clinic_id, None, patient_id, "assistant", msg)
        yield _sse({"type": "done", "citations": [], "allergy_gate_triggered": gate,
                    "insufficient_evidence": True, "ai_model": get_settings().llm_model})
        return

    # Se ofrecen las mejores fuentes numeradas; las CITAS finales son solo las que el modelo
    # referencia por [n] en su respuesta (honesto: no adjuntamos fuentes que no usó).
    literature = chunks[:CHAT_LIT_LIMIT]
    system = CHAT_SYSTEM
    user = _chat_prompt(question, literature, patient, severe)
    parts: list[str] = []
    for tok in LLMClient().stream(system, user):
        parts.append(tok)
        yield _sse({"type": "token", "text": tok})
    answer = "".join(parts)
    citations = _cited_from_answer(answer, literature)
    log_message(clinic_id, None, patient_id, "assistant", answer)
    yield _sse({"type": "done", "citations": [c.model_dump() for c in citations],
                "allergy_gate_triggered": gate, "insufficient_evidence": False,
                "ai_model": get_settings().llm_model})
