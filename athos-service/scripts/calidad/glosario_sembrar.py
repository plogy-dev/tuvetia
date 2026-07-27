# -*- coding: utf-8 -*-
"""Glosario paso 4: siembra lo validado en la DB.

Por defecto siembra como **candidate**, que es INERTE: `resolve.py` solo lee `approved`, así que
sembrar no puede romper el retrieval. Aprobar es el paso peligroso y va por TANDAS con gate:
  --aprobar-tanda N   aprueba los N descriptores de mayor cobertura que sigan en candidate.

Idempotente: no duplica términos ni sinónimos.
Uso:
  python glosario_sembrar.py                     # siembra todo como candidate
  python glosario_sembrar.py --aprobar-tanda 150 # promueve una tanda a approved
  python glosario_sembrar.py --revertir-tanda    # devuelve a candidate lo aprobado por este script
"""
import argparse, json, os, sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

import psycopg  # noqa: E402
from app.config import get_settings  # noqa: E402

ORIGEN = "es_llm_mesh"  # marca de origen: permite revertir SOLO lo que sembró este script


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--aprobar-tanda", type=int, default=0)
    ap.add_argument("--revertir-tanda", action="store_true")
    ap.add_argument("--entrada", default=os.path.join(SCRATCH, "glosario_validado.json"))
    args = ap.parse_args()

    conn = psycopg.connect(get_settings().database_url)
    cur = conn.cursor()

    if args.revertir_tanda:
        cur.execute("update public.glossary_synonym set review_status='candidate' "
                    "where origin=%s and review_status='approved'", (ORIGEN,))
        n = cur.rowcount
        conn.commit(); conn.close()
        print(f"revertidos a candidate: {n:,} sinónimos (origin={ORIGEN})")
        return

    if args.aprobar_tanda:
        # Los de mayor cobertura primero: el orden del JSON ya viene por chunks desc.
        datos = json.load(open(args.entrada, encoding="utf-8"))
        pendientes, vistos = [], 0
        for item in datos:
            cur.execute(
                "select count(*) from public.glossary_synonym s "
                "join public.glossary_term t on t.id=s.term_id "
                "where t.canonical_en=%s and s.origin=%s and s.review_status='candidate'",
                (item["canonical_en"], ORIGEN))
            if cur.fetchone()[0]:
                pendientes.append(item["canonical_en"])
                if len(pendientes) >= args.aprobar_tanda:
                    break
            vistos += 1
        for en in pendientes:
            cur.execute(
                "update public.glossary_synonym s set review_status='approved' "
                "from public.glossary_term t "
                "where t.id=s.term_id and t.canonical_en=%s and s.origin=%s "
                "and s.review_status='candidate'", (en, ORIGEN))
            cur.execute("update public.glossary_term set review_status='approved' "
                        "where canonical_en=%s", (en,))
        conn.commit()
        cur.execute("select count(*) from public.glossary_synonym where origin=%s and "
                    "review_status='approved'", (ORIGEN,))
        print(f"tanda aprobada: {len(pendientes):,} descriptores. "
              f"Sinónimos {ORIGEN} approved en total: {cur.fetchone()[0]:,}")
        conn.close()
        return

    datos = json.load(open(args.entrada, encoding="utf-8"))
    nuevos_t = nuevos_s = 0
    for item in datos:
        en, mesh = item["canonical_en"], item["mesh"]
        cur.execute("select id from public.glossary_term where canonical_en=%s", (en,))
        row = cur.fetchone()
        if row:
            term_id = row[0]
        else:
            cur.execute("insert into public.glossary_term (canonical_en, mesh_id, review_status) "
                        "values (%s,%s,'candidate') returning id", (en, mesh))
            term_id = cur.fetchone()[0]; nuevos_t += 1
        for s in item["sinonimos"]:
            cur.execute("select 1 from public.glossary_synonym where term_id=%s and lower(text)=lower(%s)",
                        (term_id, s["syn"]))
            if cur.fetchone():
                continue
            cur.execute(
                "insert into public.glossary_synonym (term_id, text, lang, register, origin, review_status) "
                "values (%s,%s,'es',%s,%s,'candidate')",
                (term_id, s["syn"], s["registro"], ORIGEN))
            nuevos_s += 1
    conn.commit()
    cur.execute("select review_status, count(*) from public.glossary_term group by 1")
    print("términos nuevos:", nuevos_t, "| sinónimos nuevos:", nuevos_s)
    print("glossary_term:", dict(cur.fetchall()))
    cur.execute("select review_status, count(*) from public.glossary_synonym group by 1")
    print("glossary_synonym:", dict(cur.fetchall()))
    conn.close()


if __name__ == "__main__":
    main()
