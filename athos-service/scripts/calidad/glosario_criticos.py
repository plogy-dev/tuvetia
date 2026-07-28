# -*- coding: utf-8 -*-
"""Curación MANUAL de los descriptores clínicos de mayor peso que el glosario no cubría.

Por qué a mano y no con `glosario_generar.py`: estos no son "una tanda más". Son condiciones que un
veterinario de la región consulta a diario y que el generador automático nunca propuso, o propuso
mal. El caso testigo: **"rabia" apuntaba a `Rhabdoviridae Infections` (6 chunks) mientras `Rabies`
(2.832 chunks) no existía en el glosario**. Un vet preguntando por rabia dependía de que el LLM
adivinara.

Cada entrada se verifica contra el corpus antes de sembrar (si el descriptor no existe o no tiene
literatura, se aborta: sembrar un término muerto sólo agrega ruido). Se siembran y aprueban en el
mismo paso porque son curados a mano, no candidatos de máquina.

Idempotente. Reversible: `--revertir` devuelve a `candidate` sólo lo que sembró este script.

Uso:
  python scripts/calidad/glosario_criticos.py --dry-run   # qué haría, sin tocar la DB
  python scripts/calidad/glosario_criticos.py
  python scripts/calidad/glosario_criticos.py --revertir
"""
import argparse
import os
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

import psycopg  # noqa: E402

from app.config import get_settings  # noqa: E402

ORIGEN = "es_curado_critico"   # marca propia: permite revertir sin tocar las tandas automáticas

# descriptor MeSH -> sinónimos en español (técnico + como lo dice el dueño).
# Los descriptores salen del `metadata->mesh` real del corpus, no de MeSH en abstracto.
CURADOS: dict[str, list[str]] = {
    # La rabia: el hueco más grave. Zoonosis de denuncia obligatoria.
    "Rabies": ["rabia", "rabia canina", "rabia felina", "hidrofobia", "mordedura sospechosa de rabia",
               "animal mordedor", "perro que mordio y esta raro"],
    "Rabies virus": ["virus de la rabia", "virus rabico"],
    # Leishmaniasis: `Leishmaniasis` ya estaba, pero la forma VISCERAL (2.835 chunks) y el agente
    # (2.689) no. Es endémica en el norte argentino y en Brasil.
    "Leishmaniasis, Visceral": ["leishmaniasis visceral", "leishmaniosis visceral", "kala azar",
                                "leishmania visceral"],
    "Leishmania infantum": ["leishmania infantum", "leishmania chagasi"],
    # Dirofilariosis: `Dirofilariasis` estaba pero sin el nombre técnico ni el agente.
    "Dirofilaria immitis": ["dirofilaria immitis", "dirofilaria"],
    # Moquillo: `Distemper` estaba; faltaba el virus (1.202 chunks).
    "Distemper Virus, Canine": ["virus del moquillo", "virus del distemper", "virus de carre"],
}

# Sinónimos que además hay que AGREGAR a términos ya existentes (huecos puntuales detectados).
EXTRA: dict[str, list[str]] = {
    "Dirofilariasis": ["dirofilariosis", "filariosis", "gusanos en el corazon"],
    "Leishmaniasis": ["leishmaniasis cutanea", "ulceras que no cierran por leishmania"],
}


def _chunks(cur, descriptor: str) -> int:
    cur.execute("select count(*) from public.corpus_chunks where metadata->'mesh' ? %s",
                (descriptor,))
    return cur.fetchone()[0]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--revertir", action="store_true")
    args = ap.parse_args()

    conn = psycopg.connect(get_settings().corpus_db_url)
    cur = conn.cursor()

    if args.revertir:
        cur.execute("update public.glossary_synonym set review_status='candidate' "
                    "where origin=%s and review_status='approved'", (ORIGEN,))
        print(f"revertidos a candidate: {cur.rowcount} sinonimos (origin={ORIGEN})")
        conn.commit()
        conn.close()
        return

    todo = {**CURADOS}
    for d, syns in EXTRA.items():
        todo.setdefault(d, []).extend(syns)

    # 1) Verificación: cada descriptor tiene que existir en el corpus con literatura real.
    sin_literatura = []
    for d in todo:
        n = _chunks(cur, d)
        print(f"  {d[:40]:<40} {n:>6} chunks")
        if n == 0:
            sin_literatura.append(d)
    if sin_literatura:
        print(f"\nABORTADO: sin literatura en el corpus -> {sin_literatura}")
        conn.close()
        sys.exit(1)

    if args.dry_run:
        print(f"\n[dry-run] sembraria/aprobaria {len(todo)} descriptores, "
              f"{sum(len(v) for v in todo.values())} sinonimos")
        conn.close()
        return

    nuevos_t = nuevos_s = reaprobados = 0
    for descriptor, sinonimos in todo.items():
        cur.execute("select id from public.glossary_term where canonical_en=%s", (descriptor,))
        row = cur.fetchone()
        if row:
            term_id = row[0]
        else:
            cur.execute("insert into public.glossary_term (canonical_en, mesh_id, review_status) "
                        "values (%s,%s,'approved') returning id", (descriptor, descriptor))
            term_id = cur.fetchone()[0]
            nuevos_t += 1
        cur.execute("update public.glossary_term set review_status='approved' where id=%s", (term_id,))
        for syn in sinonimos:
            cur.execute("select id, review_status from public.glossary_synonym "
                        "where term_id=%s and lower(text)=lower(%s)", (term_id, syn))
            existente = cur.fetchone()
            if existente:
                if existente[1] != "approved":
                    cur.execute("update public.glossary_synonym set review_status='approved' "
                                "where id=%s", (existente[0],))
                    reaprobados += 1
                continue
            cur.execute(
                "insert into public.glossary_synonym (term_id, text, lang, register, origin, "
                "review_status) values (%s,%s,'es','curado',%s,'approved')",
                (term_id, syn, ORIGEN))
            nuevos_s += 1
    conn.commit()

    print(f"\nterminos nuevos: {nuevos_t} | sinonimos nuevos: {nuevos_s} | "
          f"reaprobados: {reaprobados}")
    cur.execute("select count(*) from public.glossary_synonym where review_status='approved'")
    print(f"sinonimos approved en total: {cur.fetchone()[0]}")
    conn.close()
    print("\nRecorda invalidar la cache del glosario del servicio (TTL 300s) o esperar 5 min.")


if __name__ == "__main__":
    main()
