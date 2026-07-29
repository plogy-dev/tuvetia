# -*- coding: utf-8 -*-
"""Auditoría del esquema de PRODUCCIÓN contra lo que el repo declara. Sólo lectura.

Existe porque el 2026-07-28 descubrimos que **el esquema y el repo divergieron**: producción tenía
56 tablas y el repo declaraba 28. La capa nueva (facturación, inventario, compras, comunicaciones
de cobranza y `athos_actions`) se aplicó directo a la base y nunca llegó al repositorio.

Como ese trabajo sigue en curso, esto se vuelve a correr cada vez que el equipo aplique migraciones,
para saber **qué cambió, hasta dónde llegó y si nos afecta**.

Qué informa:
  1. el historial real de migraciones del principal (con nombre y fecha de cada una)
  2. tablas/columnas que existen en producción y el repo no declara
  3. si cambió algo en las tablas que Athos lee o escribe   <- lo único que puede rompernos
  4. señales de trabajo incompleto: FKs colgando, `updated_at` sin trigger, RLS a medias

Uso:  python scripts/calidad/auditar_esquema.py
"""
import os
import re
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.db import fetch_all  # noqa: E402

# Tablas que nuestro servicio lee o escribe: un cambio acá SÍ nos afecta.
ATHOS_USA = {
    "patients", "allergies", "medications", "transcripts", "clinical_notes", "consultations",
    "consents", "patient_embeddings", "athos_messages", "rag_retrieval_log", "rag_answer_log",
    "profiles", "clinics", "owners", "corpus_chunks", "glossary_term", "glossary_synonym",
    "consultation_audios",
}


def seccion(t: str) -> None:
    print(f"\n{'=' * 92}\n{t}\n{'=' * 92}")


def declaradas_por_el_repo() -> set[str]:
    sql = ""
    for carpeta in ("supabase/bootstrap", "supabase/migrations"):
        if not os.path.isdir(carpeta):
            continue
        for nombre in sorted(os.listdir(carpeta)):
            if nombre.endswith(".sql"):
                sql += open(os.path.join(carpeta, nombre), encoding="utf-8").read() + "\n"
    return set(re.findall(r"create table\s+(?:if not exists\s+)?public\.(\w+)", sql, re.I))


def main() -> None:
    seccion("1. HISTORIAL DE MIGRACIONES DEL PRINCIPAL (fuente de verdad de qué se aplicó)")
    try:
        filas = fetch_all("select version, name from supabase_migrations.schema_migrations "
                          "order by version")
        print(f"  {len(filas)} migraciones registradas. Últimas 15:")
        for r in filas[-15:]:
            print(f"    {r['version']:<18} {r['name'] or ''}")
        print("\n  (el historial guarda además el SQL completo en la columna `statements`:")
        print("   `select statements from supabase_migrations.schema_migrations where version=...`)")
    except Exception as e:  # noqa: BLE001
        print(f"  no accesible: {str(e)[:90]}")

    seccion("2. TABLAS: producción vs lo que el repo declara")
    repo = declaradas_por_el_repo()
    prod = {r["table_name"] for r in fetch_all(
        "select table_name from information_schema.tables "
        "where table_schema='public' and table_type='BASE TABLE'")}
    print(f"  repo declara: {len(repo)}   producción: {len(prod)}")
    fuera = sorted(prod - repo)
    print(f"\n  {len(fuera)} tablas en producción que el repo NO declara:")
    for t in fuera:
        n = fetch_all(f"select count(*) as n from public.{t}")[0]["n"] if t != "corpus_chunks" else -1
        print(f"    {t:<30} {'(corpus)' if n < 0 else str(n) + ' filas'}")
    faltan = sorted(repo - prod)
    if faltan:
        print(f"\n  declaradas en el repo y AUSENTES en producción: {faltan}")

    seccion("3. ¿CAMBIÓ ALGO EN LAS TABLAS QUE ATHOS USA? (lo único que puede rompernos)")
    for t in sorted(ATHOS_USA):
        if t not in prod:
            print(f"  !! {t}: NO EXISTE en producción")
            continue
        cols = fetch_all("select column_name, data_type from information_schema.columns "
                         "where table_schema='public' and table_name=%s "
                         "order by ordinal_position", (t,))
        print(f"  {t:<24} {len(cols)} columnas")
    print("\n  Para ver el detalle de una: select column_name, data_type from")
    print("  information_schema.columns where table_name='clinical_notes';")

    seccion("4. SEÑALES DE TRABAJO INCOMPLETO")
    print("  -- columnas *_id (uuid) sin clave foránea:")
    for r in fetch_all("""
        select c.table_name, c.column_name from information_schema.columns c
        where c.table_schema='public' and c.column_name like %s and c.data_type='uuid'
          and c.column_name not in ('id','clinic_id')
          and not exists (
            select 1 from information_schema.key_column_usage k
            join information_schema.table_constraints t
              on t.constraint_name=k.constraint_name and t.constraint_type='FOREIGN KEY'
            where k.table_schema='public' and k.table_name=c.table_name
              and k.column_name=c.column_name)
        order by c.table_name, c.column_name""", ("%\\_id",)):
        print(f"     {r['table_name']:<28} {r['column_name']}")

    print("\n  -- tablas con `updated_at` pero sin trigger que lo actualice:")
    for r in fetch_all("""
        select distinct c.table_name from information_schema.columns c
        where c.table_schema='public' and c.column_name='updated_at'
          and not exists (
            select 1 from pg_trigger tg join pg_class cl on cl.oid=tg.tgrelid
            join pg_namespace n on n.oid=cl.relnamespace
            where n.nspname='public' and cl.relname=c.table_name and not tg.tgisinternal)
        order by c.table_name"""):
        print(f"     {r['table_name']}")

    print("\n  -- tablas con RLS habilitada y CERO políticas (nadie las ve por PostgREST):")
    for r in fetch_all("""
        select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind='r' and c.relrowsecurity
          and not exists (select 1 from pg_policy p where p.polrelid=c.oid)
        order by c.relname"""):
        print(f"     {r['relname']}")
    print("     (corpus_chunks aparece acá A PROPÓSITO: lo cerró 0022_security_hardening y")
    print("      Athos entra por psycopg con service_role, que se salta RLS)")

    seccion("5. NUESTROS PERMISOS SOBRE EL RAG (que un hardening no nos deje afuera)")
    for r in fetch_all("""
        select table_name, string_agg(distinct privilege_type, ',') as permisos
        from information_schema.role_table_grants
        where table_schema='public' and grantee='service_role'
          and table_name in ('corpus_chunks','glossary_term','glossary_synonym','clinical_notes',
                             'athos_messages','rag_retrieval_log','rag_answer_log')
        group by table_name order by table_name"""):
        ok = "SELECT" in r["permisos"]
        print(f"  {r['table_name']:<22} {'OK' if ok else '!! SIN SELECT'}  {r['permisos'][:60]}")


if __name__ == "__main__":
    main()
