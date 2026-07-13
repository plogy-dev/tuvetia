"""Verificación de citas (sección 11.8): DETERMINÍSTICO, después de generar.

Cada afirmación clínica debe mapear a un chunk recuperado; lo que no mapea se descarta o se marca.
El modelo no puede inventar fuentes.
"""
from app.models import RetrievedChunk, Citation


def verify_citations(answer_text: str, cited: list[Citation],
                     retrieved: list[RetrievedChunk]) -> list[Citation]:
    """Devuelve solo las citas cuyo chunk_id existe en `retrieved`. Descarta/mar­ca las demás."""
    raise NotImplementedError("verificar que cada cita mapea a un chunk recuperado")
