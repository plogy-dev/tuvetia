"""Paso A->B (sección 11.0): arma la consulta. Glosario primero; LLM liviano solo de respaldo.

El glosario (determinístico, sin tokens) es el puente ES->EN. Cuando queda pobre (el vet/dueño usó
lenguaje que el glosario aún no cubre), un LLM LIVIANO (LLM_LIGHT_MODEL, p.ej. Haiku) distila la
consulta a conceptos clínicos canónicos en inglés + descriptores MeSH, para no anclar el retrieval
en señales incidentales. El resultado se FUSIONA con lo del glosario (aditivo, nunca reemplaza) y se
marca `distilled=True` (señal de hueco de glosario -> también dispara el Tier 2 y se loguea).
"""
import json
import re

from app.config import get_settings
from app.glossary.resolve import resolve_concepts
from app.models import StructuredQuery

# Si el glosario resuelve MENOS conceptos que esto, se distila con el LLM liviano. Calibrado
# (2026-07-22) tras ampliar el glosario curado: con el glosario rico, resolver >=3 conceptos
# coherentes (a menudo signos + un síndrome) es señal suficiente; <3 sugiere hueco real. Aun sin
# distilar, el Tier 2 vectorial cubre las queries genuinamente pobres.
MIN_CONFIDENT_CONCEPTS = 3

_DISTILL_SYSTEM = (
    "Eres un traductor clínico veterinario ES->EN para RECUPERAR literatura. Dada la consulta "
    "(transcripción o pregunta, en español), devuelve los conceptos de búsqueda en inglés que mejor "
    "recuperarían literatura relevante. Piensa en el CUADRO clínico completo, no solo palabras "
    "sueltas: signos cardinales, síndromes y las condiciones MÁS PROBABLES que los explican "
    "(p.ej. poliuria+polidipsia+pérdida de peso en gato geriátrico -> enfermedad renal crónica).\n"
    "Devuelve EXCLUSIVAMENTE JSON válido (sin texto, sin ```), con esta forma:\n"
    '{"concepts": ["English clinical terms"], "mesh": ["Standard MeSH descriptors"]}\n'
    "`concepts`: términos clínicos canónicos en inglés (signos, síndromes, enfermedades probables). "
    "`mesh`: descriptores MeSH ESTÁNDAR exactos (p.ej. 'Renal Insufficiency, Chronic', 'Polyuria', "
    "'Vomiting', 'Cats', 'Dogs'). Incluye la especie como MeSH si se conoce. Sé preciso y conciso "
    "(máx ~8 de cada uno). Si no hay señal clínica, devuelve listas vacías."
)


def _extract_json(text: str) -> dict:
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


def distill_query(text: str, species: str | None) -> tuple[list[str], list[str]]:
    """Llama al LLM LIVIANO para traducir la consulta ES a (concepts, mesh) en inglés/MeSH.

    Aislado y testeable (mockear LLMClient). Ante CUALQUIER fallo degrada a ([], []): el A->B nunca
    se rompe por el respaldo (el glosario ya dio una base).
    """
    from app.generation.llm_client import LLMClient  # import perezoso (evita ciclos/costo al importar)

    try:
        user = f"ESPECIE: {species or '?'}\nCONSULTA:\n{(text or '').strip()[:4000]}"
        raw = LLMClient(model=get_settings().llm_light_model).complete(
            _DISTILL_SYSTEM, user, max_tokens=400)
        data = _extract_json(raw)
        concepts = [str(c).strip() for c in (data.get("concepts") or []) if str(c).strip()]
        mesh = [str(m).strip() for m in (data.get("mesh") or []) if str(m).strip()]
        return concepts[:12], mesh[:12]
    except Exception:  # noqa: BLE001 — el respaldo nunca debe tumbar el A->B
        return [], []


def build_query(text: str, species: str | None) -> StructuredQuery:
    """Construye la StructuredQuery.

    1) resolve_concepts(text, species)  (determinístico, glosario `approved`).
    2) Si la detección queda pobre (< MIN_CONFIDENT_CONCEPTS), el LLM liviano distila la consulta y
       se FUSIONA (aditivo) con lo del glosario. Marca `distilled=True` para la traza y el Tier 2.
    """
    q = resolve_concepts(text, species)
    if len(q.concepts) >= MIN_CONFIDENT_CONCEPTS:
        return q
    concepts, mesh = distill_query(text, species)
    if not concepts and not mesh:
        return q
    return q.model_copy(update={
        "concepts": list(dict.fromkeys([*q.concepts, *concepts])),
        "mesh": list(dict.fromkeys([*q.mesh, *mesh])),
        "distilled": True,
    })
