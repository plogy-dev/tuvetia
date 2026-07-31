"""Fixtures compartidos. La cascada es determinística: se prueba SIN LLM.

Las fixtures de integración con DB (`require_db`, `seeded_tenants`) se SALTAN solas si la DB no
está disponible (p.ej. CI sin Postgres), y siembran/limpian datos de prueba con ids fijos.

⚠️ **NUNCA contra el proyecto PRINCIPAL.** `seeded_tenants` hace `insert` de clínicas, dueños,
pacientes y alergias, y al terminar hace `delete from public.clinics ... ` — que **cascadea**.
Correrlo contra el principal escribe y borra en la base con los datos reales de las clínicas, y
además ensucia `rag_retrieval_log` con ids de fixture.

Ya pasó: el 2026-07-30 el `.env` local apuntaba al principal (venía del "MODO PROD-LIKE" del 16-jul
que nunca se revirtió) y la suite corrió varias veces contra él. Por eso existe `_exigir_db_de_dev`:
la protección no puede depender de que alguien se acuerde de mirar el `.env`.
"""
import os
import re

import pytest

from app.models import RetrievedChunk, PatientContext

# Proyecto PRINCIPAL (producción / compartido). Ver CLAUDE.md §Entornos y docs/MIGRACIONES.md.
REF_PRINCIPAL = "auxlnexhkmtoedrzfsnz"
# Escotilla para el caso excepcional y consciente. Que sea incómoda de escribir es a propósito.
ESCOTILLA = "PERMITIR_TESTS_CONTRA_EL_PRINCIPAL"


def _ref_de(url: str) -> str:
    m = re.search(r"(?:postgres\.|//)([a-z]{20})", url or "")
    return m.group(1) if m else "(desconocido)"


def _exigir_db_de_dev() -> None:
    """Corta la corrida si la DB de PACIENTE es la del principal.

    Falla — no salta. Un `skip` es justo lo que dejó pasar esto sin que nadie lo viera.
    """
    from app.config import get_settings

    url = get_settings().database_url
    if REF_PRINCIPAL not in (url or ""):
        return
    if os.environ.get(ESCOTILLA) == "si-se-lo-que-hago":
        return
    pytest.fail(
        "\n"
        "==========================================================================\n"
        f"  DATABASE_URL apunta al proyecto PRINCIPAL (ref {_ref_de(url)}).\n"
        "==========================================================================\n"
        "  Estas pruebas SIEMBRAN Y BORRAN clínicas, dueños, pacientes y alergias.\n"
        "  Contra el principal eso escribe en la base con los datos reales de las\n"
        "  clínicas y ensucia rag_retrieval_log con ids de fixture.\n"
        "\n"
        "  Arreglo: en athos-service/.env, apuntá DATABASE_URL a tuvetia-athos-dev.\n"
        "  (CORPUS_DATABASE_URL sí puede quedarse en el principal: es de LECTURA y\n"
        "   el corpus completo de 520k fragmentos sólo vive ahí.)\n"
        "\n"
        f"  Si de verdad hace falta: {ESCOTILLA}=si-se-lo-que-hago\n"
        "==========================================================================",
        pytrace=False,
    )


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
    # El guard va ANTES de tocar la conexión: si la DB es la del principal, ni se abre.
    _exigir_db_de_dev()

    # Sin URL configurada se salta SIN intentar conectar. Si no, libpq cae a su valor por defecto
    # (localhost) y espera el timeout completo por cada prueba: la suite pasaba de 5 s a 10 min en
    # una máquina limpia — justo la que va a usar quien audite el repo.
    from app.config import get_settings
    if not (get_settings().database_url or "").strip():
        pytest.skip("DATABASE_URL sin configurar: se saltan las pruebas de integración con DB")

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


@pytest.fixture(autouse=True)
def _sin_red(monkeypatch, request):
    """Ninguna prueba sale a internet. Falla ruidosamente si alguna lo intenta.

    Existe porque el fallo contrario es SILENCIOSO y ya ocurrió tres veces el 2026-07-30: al meter
    `ProviderCascade` entre el codigo y `LLMClient`, los mocks que parcheaban el modulo viejo dejaron
    de interceptar y varias pruebas empezaron a llamar a la API de verdad. Pasaban igual (o fallaban
    por una razon confusa) y la suite tardaba el doble. Un mock que dejo de aplicar tiene que dar un
    error claro, no una factura.

    Para una prueba que SI deba salir a la red: marcarla con `@pytest.mark.red`.
    """
    if request.node.get_closest_marker("red"):
        return

    import httpx
    from starlette.testclient import TestClient

    original = httpx.Client.send

    def bloqueado(self, *a, **k):
        # `TestClient` de Starlette habla con la app POR MEMORIA a traves de httpx (su transporte es
        # ASGI, no un socket). Bloquearlo tambien rompia las pruebas del WebSocket, que no salen a
        # ningun lado. Se distingue por el tipo del cliente, no por la URL.
        if isinstance(self, TestClient):
            return original(self, *a, **k)
        raise AssertionError(
            "Esta prueba intento una llamada HTTP real. Casi seguro un mock dejo de aplicar: "
            "revisa en que modulo se resuelve el cliente (p. ej. `provider_cascade.LLMClient`, "
            "no `llm_client.LLMClient`). Si la llamada es intencional, marca la prueba con "
            "@pytest.mark.red."
        )

    def bloqueado_async(*a, **k):
        raise AssertionError(
            "Esta prueba intento una llamada HTTP real (async). Revisa los mocks o marcala "
            "con @pytest.mark.red."
        )

    monkeypatch.setattr(httpx.Client, "send", bloqueado)
    monkeypatch.setattr(httpx.AsyncClient, "send", bloqueado_async)
