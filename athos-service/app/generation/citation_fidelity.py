"""Verificación de FIDELIDAD de las citas: ¿el pasaje citado sostiene lo que se afirmó?

`citations.verify_citations` comprueba la PROCEDENCIA (que el `[n]` exista en la literatura
recuperada), que es lo que impide inventar fuentes. Pero no comprueba la PERTINENCIA, y medido
sobre 24 respuestas contra producción (2026-07-29) ahí está el hueco de confianza más grande:
**18 de 24 respuestas citan al menos un pasaje que no sostiene la afirmación**. El veterinario abre
la fuente [3] esperando el respaldo y encuentra otra cosa.

Por qué vive en el código y no en el prompt: se intentó dos veces por prompt y las dos fallaron.
La variante `citas_estrictas` (pedir cita por cláusula, prohibir la cita múltiple, nombrar el caso
de la tabla) **empeoró todas las dimensiones** y subió las citas por respuesta de 6 a 8 — insistirle
sobre las citas le sube la ansiedad por citar. Ver `scripts/calidad/prompts_variantes.py`.

Los tres patrones de infidelidad, tomados de la revisión caso por caso:
  a) EXTRAPOLAR: el pasaje dice algo vecino y la afirmación lo estira ("fuerza la interpretación").
  b) TABLA COMO NARRATIVA: se cita un listado de laboratorio para sostener un pronóstico.
  c) CITA MÚLTIPLE DECORATIVA: "[1, 5, 11]" donde ninguna sostiene la afirmación entera.
Ninguno es detectable sin leer: la verificación necesita el LLM liviano.

**Falla ABIERTA**, igual que el juez de evidencia: si el verificador no puede opinar (error,
timeout, JSON ilegible), las citas quedan como estaban. Es control de calidad, no un punto de falla.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field

from app.config import get_settings
from app.generation.llm_client import LLMClient
from app.models import RetrievedChunk

log = logging.getLogger(__name__)

PASSAGE_CHARS = 900       # por pasaje en el prompt del verificador
MAX_CLAIMS = 12           # tope de afirmaciones a verificar (acota costo y latencia)
MAX_TOKENS = 500

VERIFY_SYSTEM = (
    "Eres un auditor de citas de un sistema RAG veterinario. Te doy AFIRMACIONES que un asistente "
    "escribió, cada una con el/los PASAJE(S) que citó para respaldarla.\n"
    "Para cada afirmación decidí si el pasaje citado REALMENTE la sostiene, tal como está escrita.\n"
    "NO la sostiene si:\n"
    "  - el pasaje habla de un tema vecino pero no dice eso;\n"
    "  - la afirmación generaliza ('suele ocurrir', un porcentaje) y el pasaje describe UN caso;\n"
    "  - el pasaje es una tabla de datos o un listado y la afirmación es narrativa (evolución, "
    "pronóstico, respuesta al tratamiento);\n"
    "  - la afirmación agrega precisión (cifras, tiempos, fármacos) que el pasaje no trae.\n"
    "SÍ la sostiene si el contenido está en el pasaje, aunque con otras palabras o en inglés.\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"veredictos": [{"n": <número de la afirmación>, "sostiene": true|false}]}'
)

_CITA_RE = re.compile(r"\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]")
# Corta en fin de oración. Los marcadores [n] van pegados a la afirmación que respaldan, así que
# la oración es la unidad natural: es donde el modelo pone la cita y donde el juez la evalúa.
_SPLIT_RE = re.compile(r"(?<=[.!?;:])\s+|\n+")


@dataclass(frozen=True)
class Claim:
    """Una afirmación del texto con las fuentes que citó."""
    text: str
    sources: tuple[int, ...]


@dataclass(frozen=True)
class FidelityReport:
    """Qué números de fuente resultaron infieles. `judged=False` = no se pudo verificar."""
    unfaithful: frozenset[int] = field(default_factory=frozenset)
    judged: bool = False
    seconds: float = 0.0
    n_claims: int = 0


EMPTY_REPORT = FidelityReport()


def extract_claims(answer: str, n_sources: int) -> list[Claim]:
    """Parte la respuesta en afirmaciones citadas: (oración, fuentes que cita).

    Determinístico y testeable sin LLM. Ignora las oraciones sin cita: no fingen respaldo, así que
    no hay nada que auditar en ellas.
    """
    claims: list[Claim] = []
    for frase in _SPLIT_RE.split(answer or ""):
        nums: list[int] = []
        for m in _CITA_RE.finditer(frase):
            for x in re.split(r"\s*,\s*", m.group(1)):
                n = int(x)
                if 1 <= n <= n_sources and n not in nums:
                    nums.append(n)
        limpia = _CITA_RE.sub("", frase).strip()
        if nums and len(limpia) >= 25:      # descarta fragmentos sin contenido auditable
            claims.append(Claim(text=limpia, sources=tuple(nums)))
    return claims


def _build_prompt(claims: list[Claim], literature: list[RetrievedChunk]) -> str:
    bloques = []
    for i, c in enumerate(claims, 1):
        pasajes = "\n".join(
            f"    PASAJE [{n}]: {(literature[n - 1].content or '')[:PASSAGE_CHARS]}"
            for n in c.sources if 1 <= n <= len(literature))
        bloques.append(f"AFIRMACIÓN {i}: {c.text[:600]}\n{pasajes}")
    return "\n\n".join(bloques)


def check_fidelity(answer: str, literature: list[RetrievedChunk]) -> FidelityReport:
    """Audita las citas de `answer`. NUNCA lanza: ante cualquier problema falla abierta."""
    s = get_settings()
    if not getattr(s, "fidelity_enabled", True):
        return EMPTY_REPORT
    claims = extract_claims(answer, len(literature))
    if not claims:
        return FidelityReport(judged=True)
    claims = claims[:MAX_CLAIMS]
    t0 = time.monotonic()
    try:
        raw = LLMClient(model=s.llm_light_model).complete(
            VERIFY_SYSTEM, _build_prompt(claims, literature), max_tokens=MAX_TOKENS)
        m = re.search(r"\{.*\}", raw, re.S)
        if not m:
            raise ValueError("la respuesta del verificador no trae JSON")
        data = json.loads(m.group(0))
        if not isinstance(data.get("veredictos"), list):
            # Sin veredictos no se verificó nada. Devolver "todo bien" sería afirmar una revisión
            # que no ocurrió: hay que caer a judged=False y conservar las citas.
            raise ValueError("el verificador no devolvió veredictos")
        malas: set[int] = set()
        for v in data.get("veredictos") or []:
            idx = int(v.get("n", 0)) - 1
            if 0 <= idx < len(claims) and v.get("sostiene") is False:
                malas.update(claims[idx].sources)
        # Una fuente que sostiene ALGUNA afirmación no es infiel: sólo cae la que nunca sostuvo nada.
        buenas = {n for i, c in enumerate(claims) for n in c.sources
                  if not any(int(v.get("n", 0)) - 1 == i and v.get("sostiene") is False
                             for v in (data.get("veredictos") or []))}
        return FidelityReport(unfaithful=frozenset(malas - buenas), judged=True,
                              seconds=time.monotonic() - t0, n_claims=len(claims))
    except Exception as e:  # noqa: BLE001 — el auditor nunca rompe la respuesta
        log.warning("fidelidad de citas: no se pudo verificar (%s)", e)
        return FidelityReport(seconds=time.monotonic() - t0, n_claims=len(claims))
