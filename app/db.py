"""Acceso a Postgres/Supabase.

IMPORTANTE: el microservicio usa la service_role (se salta RLS). Por eso TODA query del lado
paciente DEBE filtrar por clinic_id explícito. El corpus/glosario son globales (sin clinic_id).
"""
import psycopg
from psycopg.rows import dict_row
from app.config import get_settings


def get_conn() -> psycopg.Connection:
    """Abre una conexión. (Para producción, considerar un pool: psycopg_pool.)

    statement_timeout acotado (15s) para queries de app: evita colgarse pero da margen al Tier 1
    a escala (que se optimiza aparte). La ingesta masiva usa su propia conexión con timeout=0.
    """
    return psycopg.connect(get_settings().database_url, row_factory=dict_row,
                           options="-c statement_timeout=15000")


def fetch_all(sql: str, params: tuple = ()) -> list[dict]:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def execute(sql: str, params: tuple = ()) -> None:
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        conn.commit()
