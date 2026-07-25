"""Acceso a Postgres/Supabase.

IMPORTANTE: el microservicio usa la service_role (se salta RLS). Por eso TODA query del lado
paciente DEBE filtrar por clinic_id explícito. El corpus/glosario son globales (sin clinic_id).
"""
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


def _get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
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
