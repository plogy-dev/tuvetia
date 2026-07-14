"""Verificación de citas (sección 11.8): DETERMINÍSTICO, después de generar.

Cada afirmación clínica debe mapear a un chunk recuperado; lo que no mapea se descarta.
El modelo no puede inventar fuentes.
"""
from app.models import RetrievedChunk, Citation


def verify_citations(answer_text: str, cited: list[Citation],
                     retrieved: list[RetrievedChunk]) -> list[Citation]:
    """Devuelve solo las citas cuyo chunk_id existe en `retrieved` (sin duplicados, en orden).

    Determinístico: el conjunto de chunks recuperados es la única fuente válida. Una cita a un
    chunk_id que no se recuperó es una fuente inventada y se descarta. `answer_text` se recibe
    para futuras comprobaciones (que la cita se use en el texto); hoy no altera el filtrado.
    """
    valid_ids = {c.chunk_id for c in retrieved}
    verified: list[Citation] = []
    seen: set[str] = set()
    for c in cited:
        if c.chunk_id in valid_ids and c.chunk_id not in seen:
            verified.append(c)
            seen.add(c.chunk_id)
    return verified
