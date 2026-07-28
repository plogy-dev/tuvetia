# -*- coding: utf-8 -*-
"""¿La lentitud del retrieval es de la BASE o de la red de quien mide?

Medir desde una notebook contra `us-west-2` mezcla latencia de red (cientos de ms por viaje) con el
costo real de la consulta. Railway corre al lado de la DB, así que lo que importa para el producto
es el tiempo **del lado del servidor**. `EXPLAIN ANALYZE` lo da sin la red.

Mide las dos consultas del hot-path:
  Tier 1: full-text + MeSH sobre 520k chunks
  Tier 2: vecino más cercano por pgvector (índice HNSW)

Uso: python scripts/calidad/latencia_db.py
"""
import os
import statistics
import sys
import time

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.db import fetch_all_corpus  # noqa: E402
from app.retrieval.cascade import (TIER1_SQL, TIER2_LIMIT, _ts_config,  # noqa: E402
                                   tier1_params)

CONCEPTOS = ["Babesiosis", "Ehrlichiosis", "Fever", "Thrombocytopenia"]
MESH = CONCEPTOS


def _tiempo_servidor(plan_rows: list[dict]) -> tuple[float, float]:
    """Extrae 'Planning Time' y 'Execution Time' del texto del plan."""
    plan = "\n".join(str(r.get("QUERY PLAN", "")) for r in plan_rows)
    def _buscar(etiqueta):
        for linea in plan.splitlines():
            if linea.strip().startswith(etiqueta):
                return float(linea.split(":")[1].strip().split(" ")[0])
        return 0.0
    return _buscar("Planning Time"), _buscar("Execution Time")


def medir(nombre: str, sql: str, params: tuple, repeticiones: int = 3) -> None:
    servidor, total = [], []
    for _ in range(repeticiones):
        t0 = time.time()
        filas = fetch_all_corpus("explain (analyze, buffers) " + sql, params)
        total.append((time.time() - t0) * 1000)
        _plan, ejec = _tiempo_servidor(filas)
        servidor.append(ejec)
    red = statistics.median(total) - statistics.median(servidor)
    print(f"  {nombre:<10} servidor {statistics.median(servidor):>8.0f} ms   "
          f"ida+vuelta {statistics.median(total):>8.0f} ms   red ~{red:>7.0f} ms")


def main() -> None:
    fila = fetch_all_corpus(
        "select embedding::text emb from public.corpus_chunks where embedding is not null limit 1")
    emb = fila[0]["emb"]
    n = fetch_all_corpus("select count(*) as n from public.corpus_chunks")[0]["n"]
    print(f"corpus: {n} chunks\n")

    cfg = _ts_config("en")
    terms = " or ".join(CONCEPTOS)
    print("consultas del hot-path (mediana de 3):")
    # El SQL sale de cascade.py: se mide lo que corre en producción, no una copia.
    medir("Tier 1", TIER1_SQL, tier1_params(cfg, terms, MESH))
    medir("Tier 2",
          "select id, source, title, content, metadata, 1 - (embedding <=> %s::vector) as sim "
          "from public.corpus_chunks where embedding is not null "
          "order by embedding <=> %s::vector limit %s",
          (emb, emb, TIER2_LIMIT))

    print("\n¿usan indice? (primeras lineas del plan)")
    for nombre, sql, params in (
        ("Tier 1", TIER1_SQL, tier1_params(cfg, terms, MESH)),
        ("Tier 2", "select id from public.corpus_chunks where embedding is not null "
                   "order by embedding <=> %s::vector limit %s", (emb, TIER2_LIMIT)),
    ):
        filas = fetch_all_corpus("explain " + sql, params)
        linea = next((str(f["QUERY PLAN"]).strip() for f in filas
                      if "Scan" in str(f["QUERY PLAN"])), "?")
        print(f"  {nombre}: {linea[:110]}")

    print("\ncompute del proyecto:")
    for r in fetch_all_corpus("select name, setting, unit from pg_settings "
                              "where name in ('shared_buffers','work_mem','max_parallel_workers')"):
        print(f"  {r['name']:<24} {r['setting']} {r['unit'] or ''}")


if __name__ == "__main__":
    main()
