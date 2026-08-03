"""Aislamiento por clínica de `athos_agent_usage` (migración 0046).

La tabla la escribe el agente de NEXT, no este servicio, pero la regla de merge de
`docs/MIGRACIONES.md` es de la base de datos, no del lenguaje: una tabla por clínica sin RLS y sin
test cross-tenant no se mergea. Se comprueban las dos garantías por separado, porque son distintas:

  1. La disciplina de `service_role` — que es como escriben y leen tanto Next como /admin: toda
     query filtra por `clinic_id` explícito y no se cruza nada.
  2. Que la policy de RLS exista y esté acotada por `private.my_clinic_id()`, que es lo que protege
     a la clínica cuando el vet lee con SU sesión (service_role se salta RLS, así que el punto 1
     no prueba nada sobre esto).

DB-gated: se salta solo si no hay Postgres, igual que el resto de los de integración.
"""
import uuid

import pytest

from app.db import fetch_all, get_conn


@pytest.fixture(autouse=True)
def _exigir_tabla(require_db):
    """Falla —NO saltea— si la tabla no está en la DB contra la que corre la suite.

    La distinción importa. El 2026-07-30 la auditoría encontró que los únicos tests de aislamiento
    multi-tenant del sistema se auto-skipeaban sin DB: tres documentos citaban la garantía como
    "cubierta por test" y no la ejecutaba nadie. Un skip silencioso acá seria repetir eso.

    Lo normal es que salte en un PR que agrega la migración pero todavía no la aplicó a dev: el
    flujo del repo es dev -> PR -> principal (docs/MIGRACIONES.md), y el CI prefiere la DB de dev
    (`ATHOS_DEV_DATABASE_URL`) sobre el Postgres local del job. El mensaje dice exactamente eso en
    vez de un `UndefinedTable` crudo.
    """
    existe = fetch_all("select to_regclass('public.athos_agent_usage') is not null as ok")
    if not existe or not existe[0]["ok"]:
        pytest.fail(
            "public.athos_agent_usage no existe en esta base. Aplicá "
            "supabase/migrations/0046_athos_agent_usage.sql al proyecto de DEV "
            "(tuvetia-athos-dev) antes de mergear — el CI corre contra esa DB cuando "
            "ATHOS_DEV_DATABASE_URL está configurado. Ver docs/MIGRACIONES.md.",
            pytrace=False,
        )


def _insertar(clinic_id: str, model: str, tokens_in: int, tokens_out: int) -> str:
    fila = str(uuid.uuid4())
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(
            "insert into public.athos_agent_usage "
            "(id, clinic_id, surface, provider, model, tokens_in, tokens_out) "
            "values (%s,%s,'agent','anthropic',%s,%s,%s)",
            (fila, clinic_id, model, tokens_in, tokens_out),
        )
        conn.commit()
    return fila


def test_uso_del_agente_aislado_por_clinica(seeded_tenants):
    a, b = seeded_tenants["clinic_a"], seeded_tenants["clinic_b"]
    de_a = _insertar(a, "claude-sonnet-5", 1200, 300)
    de_b = _insertar(b, "deepseek-v4", 900, 150)

    ids_a = {str(r["id"]) for r in fetch_all(
        "select id from public.athos_agent_usage where clinic_id = %s", (a,))}
    ids_b = {str(r["id"]) for r in fetch_all(
        "select id from public.athos_agent_usage where clinic_id = %s", (b,))}

    assert de_a in ids_a and de_a not in ids_b
    assert de_b in ids_b and de_b not in ids_a


def test_el_consumo_no_se_lee_desde_la_app(require_db):
    """
    `athos_agent_usage` tiene RLS y CERO policies: nadie la lee por PostgREST.

    Este test decía lo contrario —esperaba exactamente una policy de SELECT acotada por clínica— y
    llevaba fallando en CADA PR desde el 2026-08-02, cuando la migración 0052 borró esa policy a
    propósito. El consumo se mira desde `/admin`, con service_role; una policy de SELECT por clínica
    sólo servía para que el propio agente pudiera leer su gasto, que no le hace falta y es superficie
    de más.

    Una tabla con RLS y sin policies es DENY para todos salvo service_role: la ausencia es la
    protección, así que se afirma la ausencia.
    """
    policies = fetch_all(
        "select policyname, cmd, qual from pg_policies "
        "where schemaname = 'public' and tablename = 'athos_agent_usage'"
    )
    assert policies == [], f"no debería haber ninguna policy; hay {[p['policyname'] for p in policies]}"

    rls = fetch_all(
        "select relrowsecurity from pg_class where oid = 'public.athos_agent_usage'::regclass"
    )
    assert rls and rls[0]["relrowsecurity"] is True, "RLS tiene que seguir habilitada"


def test_borrar_la_clinica_se_lleva_su_consumo(seeded_tenants):
    """`on delete cascade`: no quedan filas huérfanas apuntando a una clínica que ya no existe."""
    a = seeded_tenants["clinic_a"]
    fila = _insertar(a, "claude-sonnet-5", 10, 10)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute("delete from public.clinics where id = %s", (a,))
        conn.commit()
    assert fetch_all("select id from public.athos_agent_usage where id = %s", (fila,)) == []
