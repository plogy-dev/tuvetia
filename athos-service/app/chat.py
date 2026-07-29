"""Chat de Athos (SSE): el vet pregunta y Athos responde con literatura citada, en streaming.

Cascada A->B -> retrieve -> umbral -> (gate de alergia) -> juez de evidencia -> B->A en streaming.
Si el retrieval no pasa el umbral, o si el juez dictamina que los pasajes no sostienen la consulta,
responde una plantilla SIN literatura ("cita o se calla"). Emite eventos SSE:
  {"type":"warning"|"token"|"done", ...}. `clinic_id` siempre explícito.
"""
import json
import logging
import re
import threading
import time

from app.config import get_settings
from app.generation.citation_fidelity import check_fidelity
from app.generation.dose_guard import (
    DOSE_NOTICE, patient_data_complete, redact_doses, split_safe_tail)
from app.generation.evidence_judge import ABSTAIN_MESSAGE, LIMITED_NOTICE, judge_evidence
from app.generation.generate import _MAX_CHUNK_CHARS
from app.generation.llm_client import LLMClient
from app.models import EVIDENCE_NONE, EVIDENCE_SUFFICIENT, Citation, PatientContext
from app.patient_context import load_patient_context
from app.retrieval.cascade import build_and_retrieve
from app.trace.logs import load_thread, log_message, log_retrieval

CHAT_LIT_LIMIT = 12   # fuentes numeradas que se ofrecen al modelo (y de las que salen las citas)
CHAT_HISTORY_MSGS = 8  # turnos previos (user/assistant) que se cargan como memoria del hilo
# Holgado: los modelos con razonamiento (p.ej. deepseek-v4-*) gastan tokens de 'thinking' antes del
# 'content'; sin margen la respuesta saldría truncada o vacía.
CHAT_MAX_TOKENS = 3000

log = logging.getLogger(__name__)

# Prompt de redacción. Medido contra el anterior sobre 15 casos del golden ampliado (juez
# deepseek-v4-pro, misma literatura recuperada para los dos): **gana 15-0**. Utilidad 3,2 -> 9,1;
# fidelidad 5,5 -> 8,4; seguridad 6,1 -> 8,7; "un veterinario experimentado seguiría esto" pasó de
# 3/23 a 13/23 en el banco completo. El anterior producía resúmenes correctos pero genéricos: el
# juez pedía SIEMPRE lo mismo (diferenciales priorizados, siguiente paso concreto, criterios de
# urgencia), que es justo lo que separa a un clínico con experiencia de un buscador.
#
# Dos decisiones no obvias:
#  - La regla 2 (marcar lo que NO está en la literatura) permite subir la utilidad SIN abrir la
#    puerta a afirmar sin respaldo: en vez de callar lo que sabe, el modelo debe declararlo.
#  - La regla de dosis NO se confía al prompt: la impone `app/generation/dose_guard` sobre el
#    texto. Con este prompt las cifras de dosis SUBIERON (2/23 -> 9/23) porque pedirle que sea
#    resolutivo lo empuja a dosificar. Endurecer el texto de la regla no alcanzó.
CHAT_SYSTEM = (
    "Eres un veterinario clínico con décadas de experiencia respondiendo a un COLEGA que tiene al "
    "paciente delante. No eres un buscador ni un resumidor de papers: tu valor está en el criterio "
    "clínico — qué es más probable, qué no se puede dejar pasar, y qué hacer AHORA.\n\n"
    "REGLAS DURAS (el sistema las verifica):\n"
    "1. Toda afirmación clínica que provenga de la LITERATURA va con su número de fuente entre "
    "corchetes ([1], [3]). Usa SOLO números presentes en la LITERATURA.\n"
    "2. Si algo es criterio clínico general y NO está en la literatura entregada, puedes decirlo, "
    "pero antepón 'Criterio clínico (no está en la literatura recuperada):'. NUNCA presentes como "
    "respaldado algo que no lo está — sobre todo fármacos, dosis, tiempos o cifras.\n"
    "3. No atribuyas a una fuente más de lo que dice: si el pasaje describe UN caso, no lo "
    "conviertas en 'suele ocurrir'.\n"
    "4. Lenguaje de posibilidad ('compatible con', 'sugestivo de'). Nunca un diagnóstico cerrado.\n"
    "5. DOSIS: si no tienes especie, peso Y edad confirmados, NO escribas ninguna cifra de dosis "
    "— ni siquiera como rango, ni 'a modo orientativo', ni citándola de la literatura. Nombra el "
    "fármaco de elección y pide el peso para dosificarlo.\n"
    "6. Si el paciente tiene alergias severas, adviértelo ANTES de cualquier plan.\n"
    "7. Di 'no hay evidencia suficiente' SOLO si NINGUNA fuente se relaciona con el cuadro.\n\n"
    "CÓMO RESPONDER (sin encabezados rígidos ni relleno; habla como a un colega):\n"
    "- Empieza por tu IMPRESIÓN CLÍNICA priorizada: lo más probable primero y por qué, y en "
    "seguida lo que NO se puede dejar pasar aunque sea menos probable (lo grave o urgente).\n"
    "- Di el SIGUIENTE PASO CONCRETO: qué prueba o maniobra pediría ya, y qué esperas que "
    "distinga. No 'se recomiendan estudios complementarios'; di cuál y para qué.\n"
    "- Menciona los CRITERIOS DE ALARMA: qué hallazgo cambiaría la conducta o exigiría "
    "hospitalización/derivación urgente.\n"
    "- Si el cuadro admite coinfecciones o el tratamiento cambia según el resultado, dilo.\n"
    "No expliques lo obvio: tu interlocutor es veterinario. Prefiere ser útil a ser exhaustivo."
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


def _cited_from_answer(answer: str, literature, drop: frozenset[int] | None = None) -> list[Citation]:
    """Devuelve SOLO las citas que el modelo referenció por número [n] en la respuesta, en orden de
    aparición y sin duplicados. Si no referenció ninguna, la lista queda vacía (honesto).

    `drop` son los números que el auditor de fidelidad marcó como no sostenidos por su pasaje: no
    se ofrecen como referencia, porque una cita que no respalda nada erosiona la confianza en todas
    las demás. Ver app/generation/citation_fidelity.py.
    """
    used: list[Citation] = []
    seen: set[int] = set()
    for m in re.findall(r"\[(\d+)\]", answer):
        n = int(m)
        i = n - 1
        if 0 <= i < len(literature) and i not in seen and not (drop and n in drop):
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


def _abstain(clinic_id: str, patient_id: str | None, gate: bool):
    """Abstención: plantilla SIN literatura, sin citas y con `evidence_level=none`.

    Un solo camino para los dos motivos de callar — el umbral determinístico de la cascada (no hay
    nada recuperado) y el juez semántico (lo recuperado no sostiene la consulta)."""
    yield _sse({"type": "token", "text": ABSTAIN_MESSAGE})
    if patient_id:
        log_message(clinic_id, None, patient_id, "assistant", ABSTAIN_MESSAGE)
    yield _sse({"type": "done", "citations": [], "allergy_gate_triggered": gate,
                "insufficient_evidence": True, "evidence_level": EVIDENCE_NONE,
                "ai_model": get_settings().llm_model})


def stream_answer(question: str, patient_id: str, clinic_id: str, user_id: str | None = None):
    """Generador de eventos SSE para /athos/chat."""
    # Consulta general (sin paciente): contexto vacío, no consultamos la ficha.
    patient = load_patient_context(clinic_id, patient_id) if patient_id else PatientContext(patient_id="")
    # A->B y recuperación juntos: el Tier 2 (vector sobre el texto crudo) se solapa con la
    # distilación del LLM liviano en vez de esperarla.
    query, chunks, passed = build_and_retrieve(question, patient.species)
    if patient_id:
        # Memoria semántica DESPUÉS del retrieval: el Tier 2 ya dejó el vector de la consulta en
        # caché, así que recordar la historia del paciente no cuesta otra llamada a Cohere.
        from app.patient_memory import index_patient_memory, recall
        patient.history_snippets = recall(clinic_id, patient_id, question)

        # Indexado perezoso EN BACKGROUND: la aprobación de notas ocurre en el front, así que el
        # backend no tiene un evento donde enganchar. Cada consulta deja lista la memoria para la
        # siguiente sin sumar latencia a ésta. Si no hay material nuevo, no llama a Cohere.
        def _indexar_memoria() -> None:
            try:
                n = index_patient_memory(clinic_id, patient_id)
                if n:
                    log.info("memoria de paciente: %s fuentes nuevas indexadas", n)
            except Exception as e:  # noqa: BLE001 — la memoria nunca rompe el chat
                log.warning("chat: falló el indexado de memoria: %s", e)

        threading.Thread(target=_indexar_memoria, daemon=True).start()
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
        yield from _abstain(clinic_id, patient_id, gate)
        return

    # Se ofrecen las mejores fuentes numeradas; las CITAS finales son solo las que el modelo
    # referencia por [n] en su respuesta (honesto: no adjuntamos fuentes que no usó).
    literature = chunks[:CHAT_LIT_LIMIT]

    # --- Juez de evidencia EN PARALELO con la redacción -----------------------------------
    # El juez cuesta ~1,8s (p90 2,3s). Encadenarlo (juzgar -> redactar) se los sumaría al tiempo
    # hasta el primer token, justo lo que el paralelismo Tier 1/Tier 2 vino a bajar. Así que
    # arrancan a la vez y los tokens quedan RETENIDOS hasta que llega el veredicto: el costo pasa de
    # (juez + primer token) a max(juez, primer token). Si el veredicto es abstención se descarta lo
    # retenido — el vet nunca vio nada que haya que desdecir. Lo único que se paga de más son los
    # tokens generados durante esos ~1,8s en los casos que abstienen (medido: ~1,4% de los buenos).
    box: dict = {}
    judged = threading.Event()

    def _judge() -> None:
        try:
            box["v"] = judge_evidence(question, literature)
        finally:
            judged.set()

    threading.Thread(target=_judge, daemon=True).start()
    deadline = time.monotonic() + get_settings().judge_chat_timeout_s

    system = CHAT_SYSTEM
    user = _chat_prompt(question, literature, patient, severe)
    parts: list[str] = []
    held: list[str] = []       # tokens retenidos mientras no haya veredicto
    verdict = None
    decided = False
    abstained = False
    errored = False

    # Gate de dosis (regla nº4): con la ficha incompleta, ninguna cifra por peso puede salir. Se
    # aplica al TEXTO, no al prompt, porque medido el prompt no la cumple (ver dose_guard). En el
    # stream hace falta un colchón: si "10 mg" se emitiera antes de que llegue "/kg", la cifra ya
    # estaría en pantalla cuando el guard la reconozca.
    dosing_ok = patient_data_complete(patient.species, patient.weight_kg, patient.age_years)
    pending = ""               # cola retenida por el colchón del guard
    dose_redacted = False

    def _emit(texto: str):
        """Emite texto ya decidido, pasándolo por el gate de dosis si la ficha no alcanza."""
        nonlocal dose_redacted
        if not texto:
            return
        if not dosing_ok:
            texto, redacted = redact_doses(texto)
            if redacted and not dose_redacted:
                dose_redacted = True
                yield _sse({"type": "warning", "text": DOSE_NOTICE})
        yield _sse({"type": "token", "text": texto})

    def _release():
        """Suelta lo retenido, precedido del aviso de banda si la evidencia es limitada."""
        nonlocal pending
        if verdict is not None and verdict.is_limited:
            yield _sse({"type": "warning", "text": LIMITED_NOTICE})
        listo, pending = split_safe_tail(pending + "".join(held))
        held.clear()
        yield from _emit(listo)

    stream = None
    try:
        stream = LLMClient().stream(system, user, history=history, max_tokens=CHAT_MAX_TOKENS)
        for tok in stream:
            parts.append(tok)
            if decided:
                pending += tok
                listo, pending = split_safe_tail(pending)
                yield from _emit(listo)
                continue
            held.append(tok)
            if not (judged.is_set() or time.monotonic() >= deadline):
                continue
            verdict = box.get("v")   # None = el juez venció el plazo -> se responde igual
            decided = True
            if verdict is not None and verdict.abstains:
                abstained = True
                break                # deja de generar: lo retenido se descarta
            yield from _release()
    except Exception as e:  # noqa: BLE001 — el proveedor LLM falló: NUNCA dejar la UI colgada.
        errored = True
        log.warning("chat: el stream del LLM falló: %s", e)
    finally:
        if stream is not None:
            stream.close()           # corta la conexión del proveedor si abstuvimos a mitad

    answer = "".join(parts)
    if not decided:
        # La redacción terminó antes que el juez: recién acá se espera (ya corrió en paralelo todo
        # lo que duró la generación, así que casi siempre está listo).
        judged.wait(max(0.0, deadline - time.monotonic()))
        verdict = box.get("v")
        decided = True
        abstained = bool(verdict is not None and verdict.abstains)
        if not abstained and answer.strip():
            yield from _release()

    if not abstained and pending:
        # Vacía el colchón del gate de dosis: ya no viene más texto, nada puede quedar partido.
        yield from _emit(pending)
        pending = ""

    if verdict is not None and verdict.judged:
        log.info("juez de evidencia: puntaje=%s banda=%s %.1fs (%s)",
                 verdict.score, verdict.band, verdict.seconds, verdict.reason[:120])

    if abstained:
        held.clear()                 # lo generado se descarta: no se muestra literatura que no cubre
        yield from _abstain(clinic_id, patient_id, gate)
        return

    level = verdict.band if verdict is not None else EVIDENCE_SUFFICIENT
    if not answer.strip():
        # El proveedor no devolvió texto (rechazó el request, timeout, etc.). Degrada con gracia:
        # aviso claro + done, para que el hilo del vet no quede "pensando" para siempre.
        yield _sse({"type": "warning",
                    "text": "No se pudo generar la respuesta en este momento. Intenta de nuevo "
                            "en unos segundos."})
        yield _sse({"type": "done", "citations": [], "allergy_gate_triggered": gate,
                    "insufficient_evidence": False, "evidence_level": level,
                    "ai_model": get_settings().llm_model, "error": errored})
        return

    # Auditoría de fidelidad de las citas. Corre DESPUÉS de que el vet ya leyó la respuesta, así que
    # no le suma latencia al primer token; lo que filtra son las REFERENCIAS del payload (la lista
    # que el front ofrece para abrir la fuente). Falla abierta: si no se pudo verificar, van todas.
    fidelity = check_fidelity(answer, literature)
    if fidelity.judged:
        log.info("fidelidad de citas: %s afirmaciones, %s fuentes descartadas %.1fs",
                 fidelity.n_claims, len(fidelity.unfaithful), fidelity.seconds)
    citations = _cited_from_answer(answer, literature, drop=fidelity.unfaithful)
    if patient_id:
        # Se guarda lo que el vet REALMENTE vio: si el gate tapó una dosis, la historia del hilo no
        # puede conservar la cifra (si no, reaparece como contexto en el próximo turno).
        visto = redact_doses(answer)[0] if not dosing_ok else answer
        log_message(clinic_id, None, patient_id, "assistant", visto)
    yield _sse({"type": "done", "citations": [c.model_dump() for c in citations],
                "allergy_gate_triggered": gate, "insufficient_evidence": False,
                "evidence_level": level, "ai_model": get_settings().llm_model})
