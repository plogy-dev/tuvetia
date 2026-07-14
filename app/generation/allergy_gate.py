"""Gate de alergia severa (sección 11.6): DETERMINÍSTICO, bloqueante, antes de cualquier plan.

Sale de la tabla `allergies` (severity='severe'). Nunca depende del LLM. Filtra por clinic_id
explícito (el microservicio usa service_role).
"""
from app.db import fetch_all


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
