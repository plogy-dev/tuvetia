"""Fixtures compartidos. La cascada es determinística: se prueba SIN LLM."""
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
