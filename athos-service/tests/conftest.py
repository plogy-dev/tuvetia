"""Fixtures compartidos. La cascada es determinística: se prueba SIN LLM.

Las fixtures de integración con DB (`require_db`, `seeded_tenants`) se SALTAN solas si la DB no
está disponible (p.ej. CI sin Postgres), y siembran/limpian datos de prueba con ids fijos.

⚠️ **NUNCA contra el proyecto PRINCIPAL.** `seeded_tenants` hace `insert` de clínicas, dueños,
pacientes y alergias, y al terminar las **borra hoja→raíz** (ver `_borrar_clinicas`). Correrlo
contra el principal escribe y borra en la base con los datos reales de las clínicas, y además
ensucia `rag_retrieval_log` con ids de fixture.

Decía que el teardown «cascadea» con un solo `delete from public.clinics`. **No cascadea**: de las
61 claves foráneas que apuntan a `clinics`, una —`audit_logs`— no lo hace, y los triggers `*_traza`
de la 0063 la vuelven a llenar durante el propio borrado. Eso hacía fallar el teardown y acumular
clínicas de prueba en la base de desarrollo (auditoría del 27-ago, hallazgo 1).

Ya pasó: el 2026-07-30 el `.env` local apuntaba al principal (venía del "MODO PROD-LIKE" del 16-jul
que nunca se revirtió) y la suite corrió varias veces contra él. Por eso existe `_exigir_db_de_dev`:
la protección no puede depender de que alguien se acuerde de mirar el `.env`.
"""
import os
import re
import uuid

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
#
# Los ids se generan POR CORRIDA, no son fijos. Antes lo eran, y contra una base de desarrollo
# COMPARTIDA eso rompe: si dos personas corren la suite a la vez, el teardown de una hace
# `delete from clinics` sobre los mismos ids y le borra los datos a la otra a mitad de prueba. El
# síntoma sería un fallo intermitente e irreproducible — de los que hacen que el equipo deje de
# creerle a la suite.
#
# Se conservan los prefijos `a1a1a1aN` / `b2b2b2bN`: si uno de estos ids aparece en un log, se
# reconoce al instante como dato de prueba. Sólo cambia la cola.
_SUFIJO = uuid.uuid4().hex[:12]

CLINIC_A = f"a1a1a1a1-0000-0000-0000-{_SUFIJO}"
CLINIC_B = f"b2b2b2b2-0000-0000-0000-{_SUFIJO}"
OWNER_A = f"a1a1a1a2-0000-0000-0000-{_SUFIJO}"
OWNER_B = f"b2b2b2b3-0000-0000-0000-{_SUFIJO}"
PATIENT_LUNA = f"a1a1a1a3-0000-0000-0000-{_SUFIJO}"   # clínica A, perro, alergia severa a pollo
PATIENT_MICHI = f"b2b2b2b4-0000-0000-0000-{_SUFIJO}"  # clínica B, gato
ALLERGY_SEVERE = f"a1a1a1a4-0000-0000-0000-{_SUFIJO}"
ALLERGY_MILD = f"a1a1a1a5-0000-0000-0000-{_SUFIJO}"


# (El guard que impedía correr contra el principal vivía acá y se eliminó al integrar master el
# 2026-07-31: `REF_PRINCIPAL` arriba en este mismo archivo hace lo mismo y mejor —tiene escotilla
# de escape explícita—, y `app/db.py` lo refuerza cortando al ABRIR la conexión, que cubre también
# las queries que se escapan de un mock. Dos guards para lo mismo, uno sin escotilla, sólo servía
# para que el override documentado no funcionara.)


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
    _borrar_clinicas(CLINIC_A, CLINIC_B)


def _borrar_clinicas(*ids: str) -> None:
    """Borra las clínicas de prueba y todo lo suyo, en orden.

    POR QUÉ NO ES UN `delete from clinics` Y YA. Lo era, y no funcionaba: de las 61 claves foráneas
    que apuntan a `clinics`, 60 cascadean y una no —`audit_logs`—, y los triggers `*_traza` de la
    migración 0063 son AFTER DELETE e insertan en `audit_logs` con el `clinic_id` de la fila que se
    acaba de borrar. O sea que el propio cascade generaba las filas que impedían que terminara, el
    teardown fallaba, y las clínicas de prueba se acumulaban en la base de desarrollo.
    (Auditoría del 27-ago, hallazgo 1. La 0098 ataca la causa raíz en la base; esto no depende de
    que esa migración esté aplicada, que es lo que se quiere de un teardown.)

    EL ORDEN IMPORTA Y `audit_logs` VA AL FINAL. Es lo contrario de lo que sugiere su profundidad de
    claves foráneas, y por eso es la línea que alguien "simplifica" dentro de seis meses: hay que
    vaciarla DESPUÉS de borrar titulares y pacientes, porque son sus triggers los que la llenan al
    borrarlos. Vaciarla antes no sirve de nada.

    Sólo se borra lo que esta fixture crea. El borrado completo de una clínica cualquiera —con
    facturación, que agrega nueve cadenas `restrict`— vive en
    `athos-service/supabase/mantenimiento/borrar_una_clinica.sql`.
    """
    with get_conn() as conn, conn.cursor() as cur:
        for tabla in ("allergies", "patients", "owners"):
            cur.execute(f"delete from public.{tabla} where clinic_id = any(%s)", (list(ids),))
        # La traza que acaban de escribir los tres deletes de arriba.
        cur.execute("delete from public.audit_logs where clinic_id = any(%s)", (list(ids),))
        cur.execute("delete from public.clinics where id = any(%s)", (list(ids),))
        conn.commit()


class LlamadaRealBloqueada(BaseException):
    """`BaseException` A PROPÓSITO, no `Exception`: los consumidores de LLM de este repo fallan
    abierto con `except Exception` (el juez devuelve OPEN_VERDICT, el chat degrada, los auditores
    devuelven reporte vacío). Con `AssertionError` el guardarraíl quedaba neutralizado justo en los
    módulos donde el fallo silencioso ya ocurrió tres veces (2026-07-30): la llamada real se
    bloqueaba, el `except Exception` se la tragaba, y el test seguía verde."""


@pytest.fixture(autouse=True)
def _sin_auditores_externos(monkeypatch, request):
    """Neutraliza los dos auditores que salen a la red, EN SUS PUNTOS DE LLAMADA.

    `check_fidelity` (LLM) y `rerank_chunks` (Cohere) son mejoras opcionales: fallan abiertas, así
    que una prueba de integración que no los mockea igual pasa — pero pagando una llamada real. En
    CI no se notaba porque no hay claves; en la máquina de un dev, correr la suite GASTABA CRÉDITO.
    Lo destapó el guardarraíl anti-red al endurecerse (2026-07-31).

    Se parchea `chat.check_fidelity` y `cascade.rerank_chunks` —donde se USAN— y no los módulos que
    los definen, así `test_citation_fidelity.py` y `test_rerank.py` siguen probándolos de verdad.

    Para una prueba que necesite el comportamiento real acá: `@pytest.mark.auditores_reales`.
    """
    if request.node.get_closest_marker("auditores_reales"):
        return
    import app.chat as chat
    import app.retrieval.cascade as cascade
    from app.generation.citation_fidelity import EMPTY_REPORT

    monkeypatch.setattr(chat, "check_fidelity",
                        lambda respuesta, literatura: EMPTY_REPORT, raising=False)
    monkeypatch.setattr(cascade, "rerank_chunks",
                        lambda consulta, chunks, top_n=None, **kw: (chunks, False), raising=False)


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
        raise LlamadaRealBloqueada(
            "Esta prueba intento una llamada HTTP real. Casi seguro un mock dejo de aplicar: "
            "revisa en que modulo se resuelve el cliente (p. ej. `provider_cascade.LLMClient`, "
            "no `llm_client.LLMClient`). Si la llamada es intencional, marca la prueba con "
            "@pytest.mark.red."
        )

    def bloqueado_async(*a, **k):
        raise LlamadaRealBloqueada(
            "Esta prueba intento una llamada HTTP real (async). Revisa los mocks o marcala "
            "con @pytest.mark.red."
        )

    monkeypatch.setattr(httpx.Client, "send", bloqueado)
    monkeypatch.setattr(httpx.AsyncClient, "send", bloqueado_async)
