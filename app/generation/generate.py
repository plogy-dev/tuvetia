"""Paso B->A (sección 11.7): la única IA de verdad. Redacta sobre el contexto entregado.

Lenguaje de posibilidad, NUNCA diagnóstico definitivo, citas mapeadas a chunks, sin dosis si
faltan datos. En Modo Fantasma: UNA sola llamada que devuelve SOAP + summary + allergy_flag.
"""
from app.models import SOAP, RetrievedChunk, PatientContext, Citation


CLINICAL_SYSTEM_PROMPT = (
    "Eres un asistente clínico veterinario. Responde SOLO con base en el contexto entregado. "
    "Usa lenguaje de posibilidad ('compatible con', 'sugestivo de'); NUNCA des un diagnóstico "
    "definitivo. Cita la fuente de cada afirmación clínica. Si no hay evidencia suficiente, dilo. "
    "No propongas dosis si faltan especie, peso o edad. Advierte alergias severas antes de un plan."
)


def generate_note(transcript: str, literature: list[RetrievedChunk], patient: PatientContext,
                  severe_allergens: list[str]) -> tuple[SOAP, list[Citation], bool]:
    """Genera la nota SOAP (Modo Fantasma) en una sola llamada.

    Devuelve (soap, citations, allergy_transcript_flag). Usa LLMClient(LLM_MODEL).
    """
    raise NotImplementedError("generación de nota SOAP + citas (una sola llamada)")


def generate_chat_answer(question: str, literature: list[RetrievedChunk], patient: PatientContext,
                         severe_allergens: list[str]):
    """Genera la respuesta del chat de Athos (idealmente en streaming). Devuelve texto + citas."""
    raise NotImplementedError("generación de respuesta de chat (SSE)")
