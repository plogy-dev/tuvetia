"""Fixtures compartidos. La cascada es determinística: se prueba SIN LLM.

Las fixtures de integración con DB (`require_db`, `seeded_tenants`) se SALTAN solas si la DB no
está disponible (p.ej. CI sin Postgres), y siembran/limpian datos de prueba con ids fijos.
"""
import pytest

from app.models import RetrievedChunk, PatientContext


@pytest.fixture
def sample_chunks() -> list[RetrievedChunk]:
    return [
        RetrievedChunk(chunk_id="c1", doc_id="PM16485488", content="feline sporotrichosis ...",
                       locator="The Study", source="PubMed", score=0.9,
                       metadata={"especie": "gato", "categoria": "dermatologia",
                                 "mesh": ["Cat Diseases", "Sporotrichosis"], "is_current": True}),
        RetrievedChunk(chunk_id="c2", doc_id="PM16225684", content="metoclopramide in chicken ...",
                       locator="Results", source="PMC OA bulk", score=0.2,
                       metadata={"especie": "ave", "is_current": True}),
    ]


@pytest.fixture
def luna_patient() -> PatientContext:
    """Caso Luna: perro con alergia severa a pollo. El gate debe dispararse antes de cualquier plan."""
    return PatientContext(patient_id="luna", species="perro", weight_kg=12.0, age_years=4.0,
                          severe_allergies=["pollo"], medications=[], history_snippets=[])


@pytest.fixture
def two_clinics() -> dict:
    """Ids de dos clínicas para tests de aislamiento (seed real en la DB de test)."""
    return {"A": "00000000-0000-0000-0000-00000000000a",
            "B": "00000000-0000-0000-0000-00000000000b"}


# --- Integración con DB (se salta si no hay DB) ---
CLINIC_A = "a1a1a1a1-0000-0000-0000-000000000001"
CLINIC_B = "b2b2b2b2-0000-0000-0000-000000000002"
OWNER_A = "a1a1a1a1-0000-0000-0000-0000000000a1"
OWNER_B = "b2b2b2b2-0000-0000-0000-0000000000b1"
PATIENT_LUNA = "a1a1a1a1-0000-0000-0000-0000000000a2"   # clínica A, perro, alergia severa a pollo
PATIENT_MICHI = "b2b2b2b2-0000-0000-0000-0000000000b2"  # clínica B, gato
ALLERGY_SEVERE = "a1a1a1a1-0000-0000-0000-0000000000a3"
ALLERGY_MILD = "a1a1a1a1-0000-0000-0000-0000000000a4"


@pytest.fixture
def require_db():
    try:
        from app.db import fetch_all
        fetch_all("select 1")
    except Exception as e:  # pragma: no cover - depende del entorno
        pytest.skip(f"DB no disponible: {e}")


@pytest.fixture
def seeded_tenants(require_db) -> dict:
    """Siembra 2 clínicas (dueño + paciente + alergias) con ids fijos y limpia al terminar."""
    from app.db import get_conn
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into public.clinics (id, name) values (%s,%s),(%s,%s) "
            "on conflict (id) do nothing",
            (CLINIC_A, "Test Clinic A", CLINIC_B, "Test Clinic B"),
        )
        cur.execute(
            "insert into public.owners (id, clinic_id, full_name) values (%s,%s,%s),(%s,%s,%s) "
            "on conflict (id) do nothing",
            (OWNER_A, CLINIC_A, "Dueno A", OWNER_B, CLINIC_B, "Dueno B"),
        )
        cur.execute(
            "insert into public.patients (id, clinic_id, owner_id, name, species, weight_kg, birth_date) "
            "values (%s,%s,%s,%s,%s,%s,%s),(%s,%s,%s,%s,%s,%s,%s) on conflict (id) do nothing",
            (PATIENT_LUNA, CLINIC_A, OWNER_A, "Luna", "perro", 12.0, "2021-01-01",
             PATIENT_MICHI, CLINIC_B, OWNER_B, "Michi", "gato", 4.5, "2022-06-01"),
        )
        cur.execute(
            "insert into public.allergies (id, clinic_id, patient_id, allergen, severity) "
            "values (%s,%s,%s,%s,'severe'),(%s,%s,%s,%s,'mild') on conflict (id) do nothing",
            (ALLERGY_SEVERE, CLINIC_A, PATIENT_LUNA, "pollo",
             ALLERGY_MILD, CLINIC_A, PATIENT_LUNA, "polen"),
        )
        conn.commit()
    yield {"clinic_a": CLINIC_A, "clinic_b": CLINIC_B, "luna": PATIENT_LUNA, "michi": PATIENT_MICHI}
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("delete from public.clinics where id in (%s,%s)", (CLINIC_A, CLINIC_B))
        conn.commit()
