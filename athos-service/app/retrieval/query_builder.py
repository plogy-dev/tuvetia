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
from app.glossary.specificity import names_a_condition
from app.models import StructuredQuery

# Mínimo de conceptos del glosario para no distilar. Calibrado (2026-07-22) tras ampliar el glosario
# curado. Es NECESARIO pero ya no suficiente: desde 2026-07-28 además alguno tiene que nombrar una
# condición concreta (ver `_glossary_is_confident`).
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
        # timeout=10: el chat y /retrieve ESPERAN esta llamada (p50 medido ~4s). Con el default de
        # 120s, un proveedor colgado costaba 120s de primer token; a los 10s se degrada al glosario,
        # que es exactamente el respaldo que este except ya implementa.
        raw = LLMClient(model=get_settings().llm_light_model, timeout=10).complete(
            _DISTILL_SYSTEM, user, max_tokens=400)
        data = _extract_json(raw)
        concepts = [str(c).strip() for c in (data.get("concepts") or []) if str(c).strip()]
        mesh = [str(m).strip() for m in (data.get("mesh") or []) if str(m).strip()]
        return concepts[:12], mesh[:12]
    except Exception:  # noqa: BLE001 — el respaldo nunca debe tumbar el A->B
        return [], []


def _glossary_is_confident(concepts: list[str]) -> bool:
    """¿Alcanza lo que resolvió el glosario, o hay que pedirle al LLM que interprete el cuadro?

    Exige las DOS cosas: suficientes conceptos Y que alguno nombre una condición concreta. Basta que
    falte una para distilar, porque la distilación es ADITIVA (nunca reemplaza lo del glosario), así
    que de más sólo cuesta latencia y de menos cuesta una respuesta.

    Medido sobre los 31 casos del golden ampliado donde la decisión cambia (retrieval real contra
    producción, hit@15):
      - exigir especificidad (antes se pasaba con 3 signos genéricos): **MEJORA 7, EMPEORA 2**.
        "Toma mucha agua, orina mucho y bajó de peso" son tres conceptos que pasaban el umbral por
        cantidad, pero ninguno nombra la enfermedad; sin distilar, el retrieval nunca recibía
        `Diabetes Mellitus`.
      - relajar la cantidad cuando ya había una condición nombrada: **3 mejoras y 3 empeoras**, un
        empate. Ahorraba ~4,3s pero a cambio de regresiones impredecibles, así que NO se adoptó: el
        LLM sigue aportando términos hermanos aunque el glosario ya haya acertado el diagnóstico.

    Si el dato de especificidad no está disponible, cae al criterio anterior por cantidad.
    """
    from app.glossary.specificity import diagnostic_descriptors
    if len(concepts) < MIN_CONFIDENT_CONCEPTS:
        return False
    if not diagnostic_descriptors():   # sin el dato MeSH, el criterio viejo es lo único que hay
        return True
    return names_a_condition(concepts)


def build_query(text: str, species: str | None) -> StructuredQuery:
    """Construye la StructuredQuery.

    1) resolve_concepts(text, species)  (determinístico, glosario `approved`).
    2) Si el glosario no nombró ninguna condición concreta, el LLM liviano distila la consulta y se
       FUSIONA (aditivo) con lo del glosario. Marca `distilled=True` para la traza y el Tier 2.
    """
    q = resolve_concepts(text, species)
    if _glossary_is_confident(q.concepts):
        return q
    concepts, mesh = distill_query(text, species)
    if not concepts and not mesh:
        return q
    return q.model_copy(update={
        "concepts": list(dict.fromkeys([*q.concepts, *concepts])),
        "mesh": list(dict.fromkeys([*q.mesh, *mesh])),
        "distilled": True,
    })
