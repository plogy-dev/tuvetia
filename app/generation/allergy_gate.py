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
