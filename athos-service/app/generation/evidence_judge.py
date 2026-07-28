"""Juez semántico de la evidencia: ¿los pasajes RECUPERADOS sostienen esta consulta?

Es el mecanismo real de la regla 1 ("cita o se calla"). Existe porque la abstención determinística
NO protegía nada: medido el 2026-07-27 sobre un banco de 187 casos (145 con literatura + 42 sin
ella), `passes_threshold` daba True en 187/187. Las tres señales gratis murieron con datos:

- **score determinístico**: mediana 1.701 en positivos y 1.700 en negativos (saturado por las
  constantes del Tier 1; y el MeSH de especie, "Dogs", cuenta como evidencia temática).
- **score del reranker**: 0.532 vs 0.499 — cortar en 0.50 atrapa el 51% de los malos pero silencia
  el 29% de los buenos.
- **nº de citas verificadas**: 6,0 vs 6,0. El modelo cita con la misma soltura cuando la literatura
  NO cubre la consulta; verificar que cada [n] mapea a un chunk recuperado confirma la procedencia,
  no la pertinencia.

La razón de fondo: en un corpus de 520k chunks SIEMPRE hay algo temáticamente plausible, y la
similitud no distingue "trata este tema" de "responde esta pregunta". Eso exige LEER: el juez
(LLM liviano) separó 7,0 en positivos vs 5,0 en negativos, con ~1,8s de latencia (p90 2,3s).

Salida en BANDAS, no binaria (el contrato viejo sólo tenía `insufficient_evidence`):
  - `none` (0-2)      -> abstención dura. Cuesta sólo 1,4% de falsos silencios.
  - `limited` (3-5)   -> se responde DECLARANDO evidencia limitada o indirecta.
  - `sufficient` (6+) -> respuesta normal.

**Falla ABIERTA**: cualquier error, timeout o JSON ilegible devuelve `sufficient` con
`judged=False`. El juez es control de calidad, no un punto de falla del chat.
"""
import logging
import time
from dataclasses import dataclass

from app.config import get_settings
from app.models import (EVIDENCE_LIMITED, EVIDENCE_NONE, EVIDENCE_SUFFICIENT, RetrievedChunk)

log = logging.getLogger(__name__)

JUDGE_CHARS = 700          # recorte por pasaje: alcanza para saber de qué trata
JUDGE_MAX_TOKENS = 300     # sólo devuelve un JSON de 3 campos
_MAX_QUERY_CHARS = 2500    # el Fantasma entra con el transcript completo

# Aviso determinístico de la banda `limited`. Lo emite el CÓDIGO, no el prompt: la regla la impone
# el sistema (igual que el gate de alergia), no la buena voluntad del modelo.
LIMITED_NOTICE = (
    "Evidencia limitada: la literatura recuperada roza el tema pero no trata la condición concreta "
    "de la consulta. Tomá lo que sigue como orientación indirecta, no como respaldo bibliográfico "
    "del caso."
)
ABSTAIN_MESSAGE = (
    "No hay evidencia suficiente en la literatura disponible para responder esta consulta con "
    "seguridad."
)

JUDGE_SYSTEM = (
    "Eres el control de calidad de un sistema RAG veterinario. Te doy la CONSULTA de un "
    "veterinario (en español) y los PASAJES de literatura que el buscador recuperó (en inglés).\n"
    "Tu única tarea: decidir si esos pasajes permiten FUNDAMENTAR una respuesta a esa consulta.\n"
    "Sé ESTRICTO. NO alcanza con que los pasajes:\n"
    "  - sean de la misma especie (perro/gato),\n"
    "  - hablen del mismo aparato o sistema en general,\n"
    "  - mencionen alguno de los signos de forma incidental.\n"
    "Alcanza SOLO si tratan la CONDICIÓN o el PROBLEMA concreto que plantea la consulta, de forma "
    "que un veterinario pudiera citarlos como respaldo.\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"puntaje": 0-10, "cubre": true|false, "motivo": "una frase"}\n'
    "puntaje 0-2 = los pasajes no tienen que ver con la consulta; 3-5 = tocan el tema de refilón "
    "(misma especie o sistema) pero no la condición; 6-8 = tratan la condición; 9-10 = la tratan "
    "de lleno y con detalle clínico útil."
)


@dataclass(frozen=True)
class EvidenceVerdict:
    """Veredicto del juez. `judged=False` = no llegó a juzgar (error/timeout) y falla abierta."""
    band: str = EVIDENCE_SUFFICIENT
    score: float | None = None
    reason: str = ""
    judged: bool = False
    seconds: float = 0.0

    @property
    def abstains(self) -> bool:
        return self.band == EVIDENCE_NONE

    @property
    def is_limited(self) -> bool:
        return self.band == EVIDENCE_LIMITED


# Veredicto de fallo abierto: no se juzgó, se responde normal (nunca callar por un error nuestro).
OPEN_VERDICT = EvidenceVerdict()
# Veredicto sin literatura: no hay nada que leer, la abstención es determinística (no cuesta LLM).
EMPTY_VERDICT = EvidenceVerdict(band=EVIDENCE_NONE, score=0.0, judged=True,
                                reason="no hay literatura recuperada")


def band_for(score: float | None) -> str:
    """Puntaje 0-10 -> banda. Los cortes son configurables (JUDGE_ABSTAIN_MAX/JUDGE_LIMITED_MAX)."""
    if score is None:
        return EVIDENCE_SUFFICIENT      # sin puntaje no se castiga al vet: falla abierta
    s = get_settings()
    if score <= s.judge_abstain_max:
        return EVIDENCE_NONE
    if score <= s.judge_limited_max:
        return EVIDENCE_LIMITED
    return EVIDENCE_SUFFICIENT


def _build_prompt(question: str, chunks: list[RetrievedChunk], passages: int) -> str:
    pasajes = "\n\n".join(f"[{i + 1}] {(c.content or '')[:JUDGE_CHARS]}"
                          for i, c in enumerate(chunks[:passages]))
    return f"CONSULTA:\n{question.strip()[:_MAX_QUERY_CHARS]}\n\nPASAJES RECUPERADOS:\n{pasajes}"


def judge_evidence(question: str, chunks: list[RetrievedChunk]) -> EvidenceVerdict:
    """Juzga si `chunks` sostiene `question`. NUNCA lanza: ante cualquier problema falla abierta.

    Ve los MEJORES `judge_passages` chunks (los mismos que encabezan la literatura que recibe la
    redacción, ya reordenados por el reranker): si el tope no sostiene la consulta, la cola menos.
    """
    if not chunks:
        return EMPTY_VERDICT
    s = get_settings()
    if not s.judge_enabled:
        return OPEN_VERDICT
    # Import perezoso (evita ciclos y el costo de importar el SDK cuando el juez está apagado).
    from app.generation.llm_client import LLMClient
    from app.retrieval.query_builder import _extract_json

    t0 = time.monotonic()
    try:
        raw = LLMClient(model=s.judge_model_name).complete(
            JUDGE_SYSTEM, _build_prompt(question, chunks, s.judge_passages),
            max_tokens=JUDGE_MAX_TOKENS)
        data = _extract_json(raw) or {}
        puntaje = data.get("puntaje")
        if not isinstance(puntaje, (int, float)) or isinstance(puntaje, bool):
            log.warning("juez de evidencia: respuesta sin puntaje utilizable (%r)", raw[:200])
            return OPEN_VERDICT
        score = max(0.0, min(10.0, float(puntaje)))
        return EvidenceVerdict(band=band_for(score), score=score,
                               reason=str(data.get("motivo") or "")[:300], judged=True,
                               seconds=round(time.monotonic() - t0, 2))
    except Exception as e:  # noqa: BLE001 — el juez jamás tumba el chat ni el Fantasma
        log.warning("juez de evidencia: falló (%s); se responde sin juzgar", e)
        return OPEN_VERDICT
