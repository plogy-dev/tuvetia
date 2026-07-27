"""Chat de Athos (SSE): el vet pregunta y Athos responde con literatura citada, en streaming.

Cascada A->B -> retrieve -> umbral -> (gate de alergia) -> B->A en streaming. Si el retrieval no
pasa el umbral, responde una plantilla SIN LLM ("cita o se calla"). Emite eventos SSE:
  {"type":"warning"|"token"|"done", ...}. `clinic_id` siempre explícito.
"""
import json
import logging
import re
import threading

from app.config import get_settings
from app.generation.generate import _MAX_CHUNK_CHARS
from app.generation.llm_client import LLMClient
from app.models import Citation, PatientContext
from app.patient_context import load_patient_context
from app.retrieval.cascade import retrieve
from app.retrieval.query_builder import build_query
from app.trace.logs import load_thread, log_message, log_retrieval

CHAT_LIT_LIMIT = 12   # fuentes numeradas que se ofrecen al modelo (y de las que salen las citas)
CHAT_HISTORY_MSGS = 8  # turnos previos (user/assistant) que se cargan como memoria del hilo
# Holgado: los modelos con razonamiento (p.ej. deepseek-v4-*) gastan tokens de 'thinking' antes del
# 'content'; sin margen la respuesta saldría truncada o vacía.
CHAT_MAX_TOKENS = 3000

log = logging.getLogger(__name__)

CHAT_SYSTEM = (
    "Eres un asistente clínico veterinario. Responde SOLO con base en la LITERATURA entregada. "
    "Usa lenguaje de posibilidad ('compatible con', 'sugestivo de'); NUNCA des un diagnóstico "
    "definitivo. No propongas dosis si faltan especie, peso o edad. Si el paciente tiene alergias "
    "severas, adviértelo antes de un plan. Sé conciso y claro.\n"
    "La LITERATURA entregada YA fue recuperada por su relevancia a la pregunta: APÓYATE en ella. "
    "Cita cada afirmación clínica con el número de su fuente entre corchetes (p.ej. [1], [3]); basta "
    "con que UNA fuente respalde o sea pertinente a una afirmación para citarla — no exijas una "
    "coincidencia perfecta. Usa SOLO números presentes en la LITERATURA y cita ÚNICAMENTE las que "
    "realmente uses. Di 'no hay evidencia suficiente' (sin citar) SOLO si NINGUNA fuente se relaciona "
    "con el cuadro."
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
            used.append(Citation.from_chunk(literature[i]))
    return used


def _thread_history(rows) -> list[dict]:
    """Filas de athos_messages (más antiguo->más reciente) -> mensajes {role, content} para el LLM.
    Limpia los extremos: el historial debe EMPEZAR con 'user' y TERMINAR con 'assistant' (turnos
    completos), para no romper la alternancia que espera la API al anexar la pregunta actual."""
    hist = [{"role": r["role"], "content": r["content"]}
            for r in rows if r.get("role") in ("user", "assistant") and (r.get("content") or "").strip()]
    while hist and hist[0]["role"] != "user":
        hist.pop(0)
    while hist and hist[-1]["role"] != "assistant":
        hist.pop()
    return hist


def _chat_prompt(question: str, literature, patient, severe_allergens) -> str:
    ficha = (f"- especie: {patient.species or '?'}; peso: {patient.weight_kg or '?'} kg; "
             f"edad: {patient.age_years or '?'} años")
    alergias = ", ".join(severe_allergens) if severe_allergens else "ninguna conocida"
    # Historia previa de ESTE paciente (patient_embeddings). Va en su propia sección y con su propia
    # regla: es memoria clínica, NO literatura — no se cita, y no puede sostener una afirmación por
    # sí sola (la regla "cita o se calla" se apoya solo en la literatura recuperada).
    historia = ""
    if getattr(patient, "history_snippets", None):
        trozos = "\n".join(f"- {s.strip()[:800]}" for s in patient.history_snippets)
        historia = ("\nHISTORIA PREVIA DE ESTE PACIENTE (contexto, NO es literatura: no la cites "
                    "y no la uses como evidencia):\n" + trozos + "\n")
    return (
        "CONTEXTO DEL PACIENTE:\n"
        f"{ficha}\n"
        f"- alergias severas conocidas: {alergias}\n"
        f"{historia}\n"
        f"PREGUNTA DEL VETERINARIO:\n{question.strip()}\n\n"
        "LITERATURA RECUPERADA (cita SOLO estas fuentes, por su número [n]):\n"
        f"{_format_numbered(literature)}"
    )


def stream_answer(question: str, patient_id: str, clinic_id: str, user_id: str | None = None):
    """Generador de eventos SSE para /athos/chat."""
    # Consulta general (sin paciente): contexto vacío, no consultamos la ficha.
    patient = load_patient_context(clinic_id, patient_id) if patient_id else PatientContext(patient_id="")
    query = build_query(question, patient.species)
    chunks, passed = retrieve(query)
    if patient_id:
        # Memoria semántica DESPUÉS del retrieval: el Tier 2 ya dejó el vector de la consulta en
        # caché, así que recordar la historia del paciente no cuesta otra llamada a Cohere.
        from app.patient_memory import recall
        patient.history_snippets = recall(clinic_id, patient_id, question)
    # Reusa las alergias severas que load_patient_context YA cargó (evita una 2ª query/conexión a
    # `allergies` por el mismo dato). En consulta general el contexto es vacío -> lista vacía.
    severe = patient.severe_allergies
    gate = bool(severe)

    # Memoria del hilo: cargar los turnos previos ANTES de loguear la pregunta actual (si no, la
    # pregunta de este turno entraría duplicada en el historial y en el prompt del turno).
    # Consulta GENERAL (sin paciente): es SIN estado — ni memoria ni traza por paciente (evita mezclar
    # consultas no relacionadas bajo un "hilo" de patient_id NULL).
    history = _thread_history(load_thread(clinic_id, patient_id, CHAT_HISTORY_MSGS)) if patient_id else []
    if patient_id:
        # Traza en background: estos 2 inserts corrían ANTES de arrancar el stream — el vet
        # esperaba 2 escrituras para ver el primer token. Best-effort: la traza nunca rompe el chat.
        def _trace_background() -> None:
            try:
                log_message(clinic_id, user_id, patient_id, "user", question)
                log_retrieval(clinic_id, "chat", (query.raw or "")[:1000], list(query.concepts),
                              [c.chunk_id for c in chunks],
                              max((c.score for c in chunks), default=0.0), passed,
                              user_id=user_id, patient_id=patient_id)
            except Exception as e:  # noqa: BLE001
                log.warning("chat: falló la traza en background: %s", e)

        threading.Thread(target=_trace_background, daemon=True).start()

    if gate:
        yield _sse({"type": "warning",
                    "text": f"Alergias severas del paciente: {', '.join(severe)}. "
                            "Tenlas en cuenta antes de cualquier plan."})

    if not passed:
        msg = ("No hay evidencia suficiente en la literatura disponible para responder esta "
               "consulta con seguridad.")
        yield _sse({"type": "token", "text": msg})
        if patient_id:
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
    errored = False
    try:
        for tok in LLMClient().stream(system, user, history=history, max_tokens=CHAT_MAX_TOKENS):
            parts.append(tok)
            yield _sse({"type": "token", "text": tok})
    except Exception as e:  # noqa: BLE001 — el proveedor LLM falló: NUNCA dejar la UI colgada.
        errored = True
        log.warning("chat: el stream del LLM falló: %s", e)

    answer = "".join(parts)
    if not answer.strip():
        # El proveedor no devolvió texto (rechazó el request, timeout, etc.). Degrada con gracia:
        # aviso claro + done, para que el hilo del vet no quede "pensando" para siempre.
        yield _sse({"type": "warning",
                    "text": "No se pudo generar la respuesta en este momento. Intenta de nuevo "
                            "en unos segundos."})
        yield _sse({"type": "done", "citations": [], "allergy_gate_triggered": gate,
                    "insufficient_evidence": False, "ai_model": get_settings().llm_model,
                    "error": errored})
        return

    citations = _cited_from_answer(answer, literature)
    if patient_id:
        log_message(clinic_id, None, patient_id, "assistant", answer)
    yield _sse({"type": "done", "citations": [c.model_dump() for c in citations],
                "allergy_gate_triggered": gate, "insufficient_evidence": False,
                "ai_model": get_settings().llm_model})
