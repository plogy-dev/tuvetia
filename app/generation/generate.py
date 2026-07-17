"""Paso B->A (sección 11.7): la única IA de verdad. Redacta sobre el contexto entregado.

Lenguaje de posibilidad, NUNCA diagnóstico definitivo, citas mapeadas a chunks, sin dosis si
faltan datos. En Modo Fantasma: UNA sola llamada que devuelve SOAP + citas + allergy_flag.

Diseño testeable: el armado del prompt (`build_note_prompt`) y el parseo/verificación de la
respuesta (`parse_note_response`) son determinísticos y se prueban sin LLM; `generate_note` solo
orquesta la (única) llamada al modelo en el medio.
"""
import json
import re

from app.generation.citations import verify_citations
from app.generation.llm_client import LLMClient
from app.models import SOAP, Citation, PatientContext, RetrievedChunk

_MAX_CHUNK_CHARS = 1200  # presupuesto acotado por chunk en el prompt

CLINICAL_SYSTEM_PROMPT = (
    "Eres un asistente clínico veterinario. Responde SOLO con base en el contexto entregado. "
    "Usa lenguaje de posibilidad ('compatible con', 'sugestivo de'); NUNCA des un diagnóstico "
    "definitivo. Cita la fuente de cada afirmación clínica. Si no hay evidencia suficiente, dilo. "
    "No propongas dosis si faltan especie, peso o edad. Advierte alergias severas antes de un plan.\n\n"
    "Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto adicional, sin ```), con esta forma:\n"
    '{"soap": {"subjective": "", "objective": "", "assessment": "", "plan": ""}, '
    '"citations": [{"chunk_id": "", "doc_id": "", "locator": "", "source": ""}], '
    '"allergy_transcript_flag": false}\n'
    "Cada afirmación del assessment/plan debe apoyarse en un chunk de la LITERATURA y citarse por "
    "su chunk_id. Cita SOLO chunk_id presentes en la literatura entregada; nunca inventes fuentes. "
    "Si no hay evidencia suficiente, dilo en assessment y deja citations en []. "
    "allergy_transcript_flag=true solo si la TRANSCRIPCIÓN menciona una alergia."
)


def _format_literature(literature: list[RetrievedChunk]) -> str:
    lines = []
    for c in literature:
        content = (c.content or "")[:_MAX_CHUNK_CHARS]
        lines.append(f"[{c.chunk_id}] fuente={c.source or '?'} loc={c.locator or '?'}\n{content}")
    return "\n\n".join(lines) if lines else "(sin literatura suficiente)"


def build_note_prompt(transcript: str, literature: list[RetrievedChunk], patient: PatientContext,
                      severe_allergens: list[str]) -> tuple[str, str]:
    """Arma (system, user) para la nota SOAP. Determinístico y testeable sin LLM."""
    ficha = (f"- especie: {patient.species or '?'}; peso: {patient.weight_kg or '?'} kg; "
             f"edad: {patient.age_years or '?'} años")
    alergias = ", ".join(severe_allergens) if severe_allergens else "ninguna conocida"
    user = (
        "CONTEXTO DEL PACIENTE:\n"
        f"{ficha}\n"
        f"- alergias severas conocidas: {alergias} (ADVERTIR antes de cualquier plan)\n\n"
        "TRANSCRIPCIÓN DE LA CONSULTA:\n"
        f"{transcript.strip() or '(vacía)'}\n\n"
        "LITERATURA RECUPERADA (cita SOLO estos chunk_id):\n"
        f"{_format_literature(literature)}"
    )
    return CLINICAL_SYSTEM_PROMPT, user


def _extract_json(text: str) -> dict:
    """Extrae el objeto JSON de la respuesta (tolera fences o texto alrededor)."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        m = re.search(r"\{.*\}", text or "", re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return {}
        return {}


def parse_note_response(text: str, literature: list[RetrievedChunk]) -> tuple[SOAP, list[Citation], bool]:
    """Parsea la respuesta del modelo y VERIFICA las citas contra la literatura recuperada
    (descarta fuentes inventadas). Determinístico. Devuelve (soap, citations, allergy_flag)."""
    data = _extract_json(text)
    s = data.get("soap") or {}
    soap = SOAP(
        subjective=str(s.get("subjective", "")),
        objective=str(s.get("objective", "")),
        assessment=str(s.get("assessment", "")),
        plan=str(s.get("plan", "")),
    )
    cited = [
        Citation(chunk_id=str(c["chunk_id"]), doc_id=str(c.get("doc_id", "")),
                 locator=c.get("locator"), source=c.get("source"))
        for c in (data.get("citations") or [])
        if isinstance(c, dict) and c.get("chunk_id")
    ]
    verified = verify_citations(text, cited, literature)
    return soap, verified, bool(data.get("allergy_transcript_flag", False))


def generate_note(transcript: str, literature: list[RetrievedChunk], patient: PatientContext,
                  severe_allergens: list[str]) -> tuple[SOAP, list[Citation], bool]:
    """Genera la nota SOAP (Modo Fantasma) en una sola llamada. Usa LLMClient(LLM_MODEL).

    Devuelve (soap, citations, allergy_transcript_flag). El gate DURO (allergy_gate_triggered) y el
    insufficient_evidence los calcula Athos aparte (determinístico), no el modelo.
    """
    system, user = build_note_prompt(transcript, literature, patient, severe_allergens)
    # La nota SOAP + citas puede ser larga; 2000 truncaba el JSON (stop_reason=max_tokens) y el
    # parseo caía a una nota vacía. 4000 da margen para que el JSON cierre completo.
    text = LLMClient().complete(system, user, max_tokens=4000)
    return parse_note_response(text, literature)


def generate_chat_answer(question: str, literature: list[RetrievedChunk], patient: PatientContext,
                         severe_allergens: list[str]):
    """Genera la respuesta del chat de Athos (idealmente en streaming). Devuelve texto + citas."""
    raise NotImplementedError("generación de respuesta de chat (SSE) — pendiente (endpoints)")
