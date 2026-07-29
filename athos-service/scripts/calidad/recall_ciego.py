# -*- coding: utf-8 -*-
"""Diagnostica el RECALL CIEGO: condiciones con literatura abundante que el retrieval nunca trae.

El síntoma está documentado desde el 2026-07-27 y sin diagnosticar: `Distemper` tiene 1.338 chunks
en el corpus y no aparece en el top-15; ídem `Lymphoma`, `Tick Infestations`, `Coccidiosis`,
`Toxocariasis`. Si la literatura correcta no llega, ninguna mejora de redacción la salva.

En vez de suponer, este script abre la cascada por etapas y localiza EN QUÉ PASO se pierde el
target. Para cada caso que falla mide, en orden:

  1. ¿el A->B nombró el concepto/MeSH del target?          -> falla de glosario o de distilación
  2. ¿el Tier 1 (léxico/MeSH) lo trae entre sus candidatos? -> falla de la consulta al corpus
  3. ¿el Tier 2 (vector) lo trae?                            -> falla del embedding
  4. ¿venía en los 40 fusionados y el RERANK lo tiró?        -> falla del reranker
  5. ¿el chunk del target existe y es alcanzable?            -> falla de filtros (is_current, idioma)

Cada respuesta apunta a un arreglo distinto, y son mutuamente excluyentes: eso es lo que convierte
"el recall es ciego" en una tarea accionable.

Uso: python scripts/calidad/recall_ciego.py [--casos distemper,lymphoma] [--k 15]
"""
import argparse
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.db import fetch_all_corpus  # noqa: E402
from app.retrieval.cascade import (  # noqa: E402
    RERANK_KEEP, tier0_filters, tier1_lexical_glossary, vector_candidates)
from app.retrieval.query_builder import build_query  # noqa: E402


def trae_target(chunks, target: str) -> int | None:
    """Posición (1-based) del primer chunk con el descriptor target, o None."""
    for i, c in enumerate(chunks, 1):
        if target in (c.metadata.get("mesh") or []):
            return i
    return None


def alcanzable(target: str) -> dict:
    """¿Existen chunks del target y pasan los filtros duros? (is_current / idioma)."""
    rows = fetch_all_corpus(
        "select count(*) as n, "
        "count(*) filter (where (metadata->>'is_current')::bool) as vigentes, "
        "count(*) filter (where metadata->>'idioma' = 'en') as en "
        "from public.corpus_chunks where metadata->'mesh' ? %s",
        (target,),
    )
    return rows[0] if rows else {"n": 0, "vigentes": 0, "en": 0}


def diagnostica(caso: dict, k: int) -> dict:
    target = caso["mesh_target"]
    query = build_query(caso["query"], caso.get("especie"))
    filtros = tier0_filters(query)

    # A->B: ¿el paso 0 llegó a nombrar el target?
    nombrado = target in query.mesh or target in query.concepts

    # Tier 1 y Tier 2 SIN rerank ni recorte, para ver quién lo tenía.
    t1 = tier1_lexical_glossary(query, filtros)
    try:
        t2 = vector_candidates(caso["query"])
    except Exception:  # noqa: BLE001 — sin Cohere el diagnóstico sigue siendo útil
        t2 = []

    # Pipeline real completo (con rerank), para saber si el target llega al veterinario.
    from app.retrieval.cascade import build_and_retrieve
    _q, finales, _p = build_and_retrieve(caso["query"], caso.get("especie"))

    corpus = alcanzable(target)
    pos_t1, pos_t2 = trae_target(t1, target), trae_target(t2, target)
    pos_fin = trae_target(finales, target)

    # El culpable es el primer eslabón que falla, en orden causal.
    if corpus["n"] == 0:
        culpa = "el corpus no tiene chunks con ese descriptor"
    elif corpus["vigentes"] == 0:
        culpa = "todos los chunks del target son is_current=false (filtro Tier 0)"
    elif not (pos_t1 or pos_t2):
        culpa = ("A->B no nombró el target y ninguna rama lo encontró"
                 if not nombrado else "el target se nombró pero ni Tier 1 ni Tier 2 lo trajeron")
    elif pos_fin is None:
        culpa = f"el RERANK lo descartó (venía en Tier1={pos_t1} Tier2={pos_t2})"
    elif pos_fin > k:
        culpa = f"llega pero fuera del top-{k} (puesto {pos_fin})"
    else:
        culpa = f"OK: llega en el puesto {pos_fin}"

    return {
        "id": caso["id"], "target": target,
        "chunks_corpus": corpus["n"], "vigentes": corpus["vigentes"], "en_ingles": corpus["en"],
        "ab_nombro_target": nombrado, "distilled": bool(query.distilled),
        "n_conceptos": len(query.concepts), "mesh_buscado": list(filtros.get("mesh") or [])[:8],
        "pos_tier1": pos_t1, "n_tier1": len(t1),
        "pos_tier2": pos_t2, "n_tier2": len(t2),
        "pos_final": pos_fin, "n_final": len(finales), "rerank_keep": RERANK_KEEP,
        "culpa": culpa,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--casos", default=None, help="ids separados por coma; por defecto los que fallan")
    ap.add_argument("--k", type=int, default=15)
    ap.add_argument("--workers", type=int, default=2)
    args = ap.parse_args()

    casos = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8"))
    if args.casos:
        pedidos = {c.strip() for c in args.casos.split(",")}
        casos = [c for c in casos if c["id"] in pedidos]
    else:
        # Por defecto, los que la ÚLTIMA corrida de retrieval dejó sin el target en el top-k y que
        # SÍ tienen literatura abundante: son exactamente los del recall ciego.
        previas = sorted(f for f in os.listdir(SCRATCH) if f.startswith("golden_ampliado_"))
        if previas:
            prev = os.path.join(SCRATCH, previas[-1])
            print(f"(casos tomados de {previas[-1]})")
            fallidos = {f["id"] for f in json.load(open(prev, encoding="utf-8"))
                        if not f.get("hit_k") and f.get("chunks_corpus", 0) >= 100}
            casos = [c for c in casos if c["id"] in fallidos]
        else:
            casos = casos[:12]
    print(f"diagnosticando {len(casos)} casos\n")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(diagnostica, c, args.k): c for c in casos}
        for fut in as_completed(futs):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"  caso {futs[fut]['id']} falló: {e}")

    print("=" * 100)
    print("DÓNDE SE PIERDE EL TARGET")
    print("=" * 100)
    for f in sorted(filas, key=lambda x: -x["chunks_corpus"]):
        print(f"\n{f['id']}  ->  {f['target']}  ({f['chunks_corpus']:,} chunks, "
              f"{f['vigentes']:,} vigentes)")
        print(f"   A->B nombró el target: {f['ab_nombro_target']}   distiló: {f['distilled']}   "
              f"conceptos: {f['n_conceptos']}")
        print(f"   MeSH que se buscó: {f['mesh_buscado']}")
        print(f"   Tier1: {f['pos_tier1']}/{f['n_tier1']}   Tier2: {f['pos_tier2']}/{f['n_tier2']}"
              f"   final: {f['pos_final']}/{f['n_final']}")
        print(f"   >> {f['culpa']}")

    print("\n" + "=" * 100)
    print("RESUMEN DE CULPAS")
    print("=" * 100)
    from collections import Counter
    for culpa, n in Counter(f["culpa"].split(" (")[0] for f in filas).most_common():
        print(f"  {n:3}  {culpa}")

    out = os.path.join(SCRATCH, "recall_ciego.json")
    json.dump(filas, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  -> {out}")


if __name__ == "__main__":
    main()
