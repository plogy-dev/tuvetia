"""Acceso a Postgres/Supabase.

IMPORTANTE: el microservicio usa la service_role (se salta RLS). Por eso TODA query del lado
paciente DEBE filtrar por clinic_id explícito. El corpus/glosario son globales (sin clinic_id).
"""
import os
import sys

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from app.config import get_settings

# Pools de conexión (uno por DB). Antes, cada fetch_all/execute abría una conexión NUEVA (handshake
# TCP+TLS+auth por red): un solo /athos/chat abría ~10 en serie antes del primer token. El pool
# reusa conexiones -> el coste por query baja a ~0. Se crean perezosos y se reusan por proceso.
_CONN_KWARGS = {"row_factory": dict_row, "options": "-c statement_timeout=15000"}
_pool: ConnectionPool | None = None
_corpus_pool: ConnectionPool | None = None

# --- Cortafuegos: bajo pytest, NUNCA se abre la DB de paciente del proyecto principal -----------
#
# Por qué acá y no en un fixture. La protección anterior vivía en `conftest.py` y sólo cubría las
# pruebas que declaran `require_db`/`seeded_tenants`. Pero `test_chat.py` y `test_phantom.py` pasan
# `clinic_id="clinic-a"` y llegan a la base por MOCKS — y un mock que deja de aplicar no avisa: es
# exactamente como aparecieron los `invalid input syntax for type uuid: "clinic-a"` en los logs del
# principal. Ya pasó tres veces hoy con el mock de `LLMClient` al meter `ProviderCascade` en el medio.
#
# Una protección que depende de que todos los mocks sigan puestos no es una protección. Ésta corta
# en el único punto por el que pasa todo: abrir la conexión.
#
# Sólo aplica a la DB de PACIENTE (donde están las escrituras). El CORPUS es de lectura y sus 520k
# fragmentos sólo viven en el principal, así que ahí sí se permite.
REF_PRINCIPAL = "auxlnexhkmtoedrzfsnz"
ESCOTILLA = "PERMITIR_TESTS_CONTRA_EL_PRINCIPAL"


def _bajo_pytest() -> bool:
    return "pytest" in sys.modules or bool(os.environ.get("PYTEST_CURRENT_TEST"))


def _vetar_principal_en_tests(url: str) -> None:
    if not _bajo_pytest() or REF_PRINCIPAL not in (url or ""):
        return
    if os.environ.get(ESCOTILLA) == "si-se-lo-que-hago":
        return
    raise RuntimeError(
        f"BLOQUEADO: una prueba intentó abrir la DB de paciente del proyecto PRINCIPAL "
        f"({REF_PRINCIPAL}). Las pruebas siembran y BORRAN clínicas. Apuntá DATABASE_URL a "
        f"tuvetia-athos-dev (o al Postgres local). Si de verdad hace falta: "
        f"{ESCOTILLA}=si-se-lo-que-hago"
    )


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _vetar_principal_en_tests(get_settings().database_url)
        _pool = ConnectionPool(get_settings().database_url, min_size=1, max_size=10,
                               max_idle=300, kwargs=_CONN_KWARGS, open=True)
    return _pool


def _get_corpus_pool() -> ConnectionPool:
    global _corpus_pool
    if _corpus_pool is None:
        _corpus_pool = ConnectionPool(get_settings().corpus_db_url, min_size=1, max_size=10,
                                      max_idle=300, kwargs=_CONN_KWARGS, open=True)
    return _corpus_pool


def get_conn() -> psycopg.Connection:
    """Abre una conexión NUEVA (fuera del pool). Para callers que manejan su propia transacción/
    timeout (p.ej. la ingesta masiva con statement_timeout=0). El hot-path usa fetch_all/execute (pool).
    """
    _vetar_principal_en_tests(get_settings().database_url)
    return psycopg.connect(get_settings().database_url, row_factory=dict_row,
                           options="-c statement_timeout=15000")


def get_corpus_conn() -> psycopg.Connection:
    """Conexión NUEVA a la DB del CORPUS/glosario (global, sin datos de paciente). Puede ser un
    proyecto distinto al principal. El hot-path usa fetch_all_corpus/execute_corpus (pool)."""
    return psycopg.connect(get_settings().corpus_db_url, row_factory=dict_row,
                           options="-c statement_timeout=15000")


def fetch_all(sql: str, params: tuple = ()) -> list[dict]:
    with _get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_all_corpus(sql: str, params: tuple = ()) -> list[dict]:
    """Como fetch_all pero contra la DB del corpus/glosario."""
    with _get_corpus_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def execute(sql: str, params: tuple = ()) -> None:
    # pool.connection() commitea al salir sin error (rollback si hay excepción).
    with _get_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)


def execute_corpus(sql: str, params: tuple = ()) -> None:
    """Como execute pero contra la DB del corpus/glosario."""
    with _get_corpus_pool().connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
