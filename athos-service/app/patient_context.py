"""Contexto de paciente (por clínica, RLS). El microservicio usa service_role (se salta RLS),
así que TODA query filtra por `clinic_id` explícito. Se fusiona con la literatura EN MEMORIA."""
from datetime import date

from app.db import fetch_all
from app.models import PatientContext


def _age_years(birth_date) -> float | None:
    if not birth_date:
        return None
    return round((date.today() - birth_date).days / 365.25, 1)


def load_patient_context(clinic_id: str, patient_id: str,
                         query_vector=None) -> PatientContext:
    """Carga la ficha estructurada del paciente (especie, peso, edad, alergias severas, medicación)
    filtrando SIEMPRE por clinic_id explícito. Si el paciente no existe en esa clínica, devuelve un
    contexto vacío (aislamiento cross-tenant).

    `query_vector` (opcional) activa la MEMORIA SEMÁNTICA: trozos de consultas anteriores de ESTE
    paciente parecidos a lo que se está preguntando. Se recibe ya calculado porque el Tier 2 de la
    cascada embeddiza la consulta y la cachea: recordar no cuesta una llamada extra a Cohere.
    """
    prows = fetch_all(
        "select species, weight_kg, birth_date from public.patients "
        "where clinic_id = %s and id = %s",
        (clinic_id, patient_id),
    )
    if not prows:
        return PatientContext(patient_id=patient_id)
    p = prows[0]
    severe = [
        r["allergen"]
        for r in fetch_all(
            "select allergen from public.allergies "
            "where clinic_id = %s and patient_id = %s and severity = 'severe'",
            (clinic_id, patient_id),
        )
    ]
    meds = [
        r["drug_name"]
        for r in fetch_all(
            "select drug_name from public.medications where clinic_id = %s and patient_id = %s",
            (clinic_id, patient_id),
        )
    ]
    historia: list[str] = []
    if query_vector is not None:
        # Best-effort: la memoria enriquece la respuesta, nunca puede romper el chat.
        try:
            from app.patient_memory import search_patient_memory
            historia = search_patient_memory(clinic_id, patient_id, query_vector)
        except Exception:  # noqa: BLE001
            historia = []
    return PatientContext(
        patient_id=patient_id,
        species=p["species"],
        weight_kg=float(p["weight_kg"]) if p["weight_kg"] is not None else None,
        age_years=_age_years(p["birth_date"]),
        severe_allergies=severe,
        medications=meds,
        history_snippets=historia,
    )


def load_recent_assessment(clinic_id: str, patient_id: str) -> str | None:
    """La evaluación clínica más reciente de este paciente, para saber QUÉ buscar.

    PARA QUÉ. Cuando el vet pregunta "¿qué piensas sobre la condición de Manchita?", la condición no
    está en la pregunta: está acá. Sin esto, el retrieval busca a ciegas y el juez de evidencia
    abstiene con razón. Ver `app/retrieval/referencial.py`, que documenta el caso con su traza.

    QUÉ DEVUELVE. La `assessment` de la nota más reciente —que es donde el SOAP nombra el cuadro y
    los diferenciales— y si estuviera vacía, la `subjective`. Nada más: el objetivo es una consulta
    de búsqueda bien formada, no volcarle la historia entera al modelo.

    DRAFT TAMBIÉN CUENTA. Se ordena por fecha sin filtrar por estado: en el caso que originó esto la
    nota tenía 55 minutos y estaba en `draft`, porque la aprobación del vet ocurre después. Exigir
    `approved` dejaría fuera justo la consulta que se acaba de terminar, que es la que el vet tiene
    en la cabeza cuando pregunta. No hay riesgo de "aprobar por la ventana": esto no entra a la
    historia clínica ni se cita — sólo orienta la búsqueda.

    `clinic_id` explícito en el JOIN y en las dos tablas: el servicio corre con service_role y se
    salta RLS (regla 7). `clinical_notes` no tiene `patient_id` propio, cuelga de `consultations`.
    """
    rows = fetch_all(
        "select n.assessment, n.subjective "
        "from public.clinical_notes n "
        "join public.consultations c "
        "  on c.id = n.consultation_id and c.clinic_id = n.clinic_id "
        "where n.clinic_id = %s and c.patient_id = %s "
        "order by n.created_at desc limit 1",
        (clinic_id, patient_id),
    )
    if not rows:
        return None
    r = rows[0]
    return (r["assessment"] or "").strip() or (r["subjective"] or "").strip() or None
