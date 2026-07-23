"""Gate de alergia severa (sección 11.6): DETERMINÍSTICO, bloqueante, antes de cualquier plan.

Sale de la tabla `allergies` (severity='severe'). Nunca depende del LLM. Filtra por clinic_id
explícito (el microservicio usa service_role).

Incluye además `transcript_mentions_allergy`: backstop DETERMINÍSTICO del `allergy_transcript_flag`
(que el modelo evalúa de forma no-determinística). Cubre el hueco donde una alergia se dice en la
consulta pero NO tiene fila en `allergies` (el gate DURO no la vería): ahí el flag del transcript es
la única señal, y no puede depender de que el LLM la pesque esa vez.
"""
import re
import unicodedata

from app.db import fetch_all

# Núcleo de la mención de alergia (ES + EN), sobre texto normalizado (minúsculas, sin acentos).
_ALLERGY_CUE = r"(?:alerg|allerg|hipersensibil|hypersensitiv|anafilax|anaphylax)"
_ALLERGY = re.compile(_ALLERGY_CUE)
# Mención NEGADA: un negador seguido (hasta 3 palabras no-cue en medio) de la mención. El lookahead
# evita que una palabra intermedia sea a su vez un cue, para que el negador ate solo a la mención
# MÁS CERCANA ('sin alergias pero alergico a X' -> solo 'sin alergias' queda negado).
_NEGATED_ALLERGY = re.compile(
    r"\b(?:sin|no|niega|niegan|nego|ningun\w*|descarta\w*|negativ\w*)\b"
    r"(?:\s+(?!" + _ALLERGY_CUE + r")\w+){0,3}\s+" + _ALLERGY_CUE
)


def _strip_accents(text: str) -> str:
    return unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode("ascii").lower()


def transcript_mentions_allergy(transcript: str) -> bool:
    """Backstop DETERMINÍSTICO del `allergy_transcript_flag`: ¿la transcripción menciona una alergia
    NO negada? Se OR-ea con el flag (no-determinístico) del modelo para no perder una alergia dicha
    en la consulta que aún no tiene fila en `allergies`.

    Salta las negaciones frecuentes ('sin alergias conocidas', 'no refiere alergias', 'niega
    alergias') para no ensuciar consultas rutinarias con falsos positivos. Sesgo a seguridad: una
    sola mención afirmativa basta para marcar.
    """
    t = _strip_accents(transcript)
    t = _NEGATED_ALLERGY.sub(" ", t)   # borra las menciones negadas
    return bool(_ALLERGY.search(t))    # ¿queda alguna mención afirmativa?


def severe_allergies(clinic_id: str, patient_id: str) -> list[str]:
    """Devuelve los alérgenos severos conocidos del paciente."""
    rows = fetch_all(
        "select allergen from public.allergies "
        "where clinic_id = %s and patient_id = %s and severity = 'severe'",
        (clinic_id, patient_id),
    )
    return [r["allergen"] for r in rows]


def gate_triggered(severe_allergens: list[str]) -> bool:
    """Decisión DURA del gate: si hay alergia severa conocida, se dispara (antes de cualquier
    plan). Determinística; nunca depende del LLM."""
    return bool(severe_allergens)


def evaluate_gate(clinic_id: str, patient_id: str) -> tuple[bool, list[str]]:
    """Lee `allergies` (con clinic_id explícito) y decide el gate.
    Devuelve (disparado, alérgenos_severos). Escríbelo en clinical_notes.allergy_gate_triggered."""
    severe = severe_allergies(clinic_id, patient_id)
    return gate_triggered(severe), severe
