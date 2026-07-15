"""Aislamiento por clínica: un usuario de B no puede ver filas de A.

El microservicio usa service_role (se salta RLS), así que la garantía es que TODA query filtra
por `clinic_id` explícito. DB-gated: se salta si no hay Postgres disponible.
"""
from app.generation.allergy_gate import severe_allergies
from app.patient_context import load_patient_context
from app.trace.logs import log_retrieval
from app.db import fetch_all


def test_alergias_severas_aisladas_por_clinica(seeded_tenants):
    a, b, luna = seeded_tenants["clinic_a"], seeded_tenants["clinic_b"], seeded_tenants["luna"]
    assert severe_allergies(a, luna) == ["pollo"]     # clínica correcta -> ve la alergia
    assert severe_allergies(b, luna) == []            # clínica ajena -> NO ve nada


def test_contexto_paciente_aislado_por_clinica(seeded_tenants):
    a, b, luna = seeded_tenants["clinic_a"], seeded_tenants["clinic_b"], seeded_tenants["luna"]
    ok = load_patient_context(a, luna)
    assert ok.species == "perro"
    assert ok.severe_allergies == ["pollo"]
    cross = load_patient_context(b, luna)              # el paciente de A no existe para B
    assert cross.species is None
    assert cross.severe_allergies == []


def test_trazas_aisladas_por_clinica(seeded_tenants):
    a, b = seeded_tenants["clinic_a"], seeded_tenants["clinic_b"]
    rid = log_retrieval(a, "chat", "vomito", ["Vomiting"], [], 0.7, True)
    ids_a = {str(r["id"]) for r in fetch_all(
        "select id from public.rag_retrieval_log where clinic_id = %s", (a,))}
    ids_b = {str(r["id"]) for r in fetch_all(
        "select id from public.rag_retrieval_log where clinic_id = %s", (b,))}
    assert rid in ids_a
    assert rid not in ids_b
