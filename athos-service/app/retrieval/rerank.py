"""Reranking (sección 11.3): reordena los candidatos fusionados por relevancia REAL a la consulta.

Por qué existe: Tier 1 (léxico/MeSH) y Tier 2 (vector) traen 40 candidatos por señales baratas y
parciales. Medido sobre el golden ampliado (146 casos anclados al corpus), sin rerank la
`precision@15` es ~19%: 4 de cada 5 chunks que llegan a la generación NO son de la condición
consultada. El reranker es un cross-encoder: mira consulta y documento JUNTOS, así que distingue
"habla del tema" de "comparte palabras con el tema".

Degrada con gracia, igual que el Tier 2: ante cualquier fallo (sin key, timeout, 429) devuelve los
chunks como venían. El reranking mejora la calidad; su ausencia nunca puede romper el retrieval.
"""
import httpx

from app.config import get_settings
from app.embeddings import _tls_context
from app.models import RetrievedChunk

# Tope corto: el rerank está en la ruta crítica del chat. Si Cohere no responde, seguimos sin él.
RERANK_TIMEOUT_S = 4.0
# Cohere solo ve los primeros ~4k caracteres útiles; recortar acota payload y latencia sin perder
# señal (el chunk ya es una unidad temática).
MAX_DOC_CHARS = 4000


class RerankUnavailable(Exception):
    """El reranker no pudo usarse. Siempre se captura: el retrieval sigue sin rerank."""


def _cohere_rerank(query: str, documentos: list[str], top_n: int, s) -> list[tuple[int, float]]:
    """Devuelve [(índice_original, score)] ordenado por relevancia. Lanza RerankUnavailable."""
    try:
        with httpx.Client(verify=_tls_context(), timeout=RERANK_TIMEOUT_S) as client:
            r = client.post(
                "https://api.cohere.com/v2/rerank",
                headers={"Authorization": f"Bearer {s.rerank_key}"},
                json={"model": s.rerank_model, "query": query[:2000],
                      "documents": documentos, "top_n": top_n},
            )
            if r.status_code >= 400:
                raise RerankUnavailable(f"Cohere rerank HTTP {r.status_code}: {r.text[:200]}")
            data = r.json()
    except httpx.HTTPError as e:
        raise RerankUnavailable(f"Cohere rerank no respondió: {e}") from e
    return [(int(x["index"]), float(x.get("relevance_score") or 0.0))
            for x in (data.get("results") or [])]


def rerank_chunks(query_text: str, chunks: list[RetrievedChunk],
                  top_n: int) -> tuple[list[RetrievedChunk], bool]:
    """Reordena `chunks` por relevancia a `query_text` y devuelve (chunks, se_aplicó).

    NO toca `chunk.score`: el score determinístico sigue siendo el que evalúa el umbral, así que
    activar el rerank cambia QUÉ literatura llega a la generación, no cuándo Athos se abstiene.
    El score del reranker queda en `metadata['rerank_score']` para la traza.
    """
    s = get_settings()
    if not s.rerank_enabled or not s.rerank_key or len(chunks) <= 1:
        return chunks[:top_n], False
    documentos = [(c.content or "")[:MAX_DOC_CHARS] for c in chunks]
    if not any(documentos):
        return chunks[:top_n], False
    try:
        orden = _cohere_rerank(query_text, documentos, min(top_n, len(chunks)), s)
    except RerankUnavailable:
        return chunks[:top_n], False
    except Exception:  # noqa: BLE001 — el rerank JAMÁS puede tumbar el retrieval
        return chunks[:top_n], False
    if not orden:
        return chunks[:top_n], False
    salida = []
    for idx, score in orden:
        if 0 <= idx < len(chunks):
            c = chunks[idx]
            c.metadata = {**(c.metadata or {}), "rerank_score": round(score, 5)}
            salida.append(c)
    return salida, True
