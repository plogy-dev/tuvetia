# -*- coding: utf-8 -*-
"""Golden ampliado, paso 2: mide RECUPERACIÓN objetiva sobre los casos anclados al corpus.

Por cada caso corre el pipeline real (build_query -> retrieve) y pregunta al corpus, no a una
opinión: ¿cuántos de los chunks devueltos llevan el descriptor MeSH target en su `metadata->mesh`?

Métricas (las que mueven el rerank):
  hit@k        : el caso trajo al menos 1 chunk del target  -> mide RECALL
  precision@k  : fracción de los k primeros que son del target -> mide RUIDO (lo que arregla rerank)
  primer_rank  : posición del primer acierto (1 = perfecto)
  pass_umbral  : el retrieval no se abstuvo

Uso: python golden_eval.py --etiqueta baseline [--k 15]
"""
import argparse, json, os, statistics, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

from app.retrieval.cascade import retrieve       # noqa: E402
from app.retrieval.query_builder import build_query  # noqa: E402


def evaluar(caso, k):
    q = build_query(caso["query"], caso["especie"])
    chunks, passed = retrieve(q)
    objetivo = caso["mesh_target"]
    marcas = [objetivo in (c.metadata.get("mesh") or []) for c in chunks]
    aciertos_k = sum(marcas[:k])
    primer = next((i + 1 for i, m in enumerate(marcas) if m), None)
    return {
        "id": caso["id"], "mesh_target": objetivo, "chunks_corpus": caso.get("chunks_corpus", 0),
        "n_devueltos": len(chunks), "distilled": bool(q.distilled), "n_conceptos": len(q.concepts),
        "passed": passed, "hit_total": any(marcas), "hit_k": aciertos_k > 0,
        "aciertos_k": aciertos_k, "precision_k": aciertos_k / max(k, 1), "primer_rank": primer,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--etiqueta", required=True)
    ap.add_argument("--k", type=int, default=15)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    casos = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8"))
    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(evaluar, c, args.k): c for c in casos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001 — un caso roto no invalida la medición
                log(f"  caso {futs[fut]['id']} falló: {e}")
            if i % 25 == 0:
                log(f"  {i}/{len(casos)} evaluados")

    n = len(filas)
    hit_total = sum(f["hit_total"] for f in filas)
    hit_k = sum(f["hit_k"] for f in filas)
    passed = sum(f["passed"] for f in filas)
    distil = sum(f["distilled"] for f in filas)
    prec = statistics.mean(f["precision_k"] for f in filas)
    rangos = [f["primer_rank"] for f in filas if f["primer_rank"]]
    print("=" * 78)
    print(f"GOLDEN AMPLIADO — {args.etiqueta}   ({n} casos, k={args.k})")
    print("=" * 78)
    print(f"  hit@40 (recall, algún chunk del target) : {hit_total}/{n}  ({hit_total/n:.1%})")
    print(f"  hit@{args.k} (target en el top-{args.k})           : {hit_k}/{n}  ({hit_k/n:.1%})")
    print(f"  precision@{args.k} promedio                  : {prec:.1%}   <- lo que mejora el rerank")
    print(f"  rank del primer acierto (mediana)       : {statistics.median(rangos) if rangos else '-'}")
    print(f"  pasa umbral (no se abstiene)            : {passed}/{n}  ({passed/n:.1%})")
    print(f"  pidió distilación al LLM                : {distil}/{n}")
    out = os.path.join(SCRATCH, f"golden_ampliado_{args.etiqueta}.json")
    json.dump(filas, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"  -> {out}")

    peores = sorted([f for f in filas if not f["hit_k"]], key=lambda f: -f["chunks_corpus"])[:12]
    if peores:
        print(f"\n  casos SIN el target en el top-{args.k} (los que más duelen, hay literatura):")
        for f in peores:
            print(f"    {f['chunks_corpus']:5,} chunks en corpus  {f['mesh_target']}"
                  f"   (primer acierto: {f['primer_rank'] or 'NINGUNO'})")


if __name__ == "__main__":
    main()
