# -*- coding: utf-8 -*-
"""¿En qué casos cambia la decisión del A->B al pasar de CONTAR conceptos a pesar su ESPECIFICIDAD?

Sólo puede haber diferencia de resultado donde la decisión cambia, así que este script la aísla
antes de gastar retrieval: resuelve el glosario UNA vez por caso (sin Cohere, sin vector) y compara
las dos reglas. Después, `ab_decision_diff.py --retrieval` mide hit@k sólo en esos casos.

  regla vieja: distilar si len(concepts) < MIN_CONFIDENT_CONCEPTS
  regla nueva: distilar salvo que el glosario haya nombrado una CONDICIÓN concreta

Uso:
  python scripts/calidad/ab_decision_diff.py              # sólo el diff de decisiones (segundos)
  python scripts/calidad/ab_decision_diff.py --retrieval  # + mide hit@15 en los casos que cambian
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.glossary.resolve import resolve_concepts                      # noqa: E402
from app.models import StructuredQuery                                 # noqa: E402
from app.retrieval.cascade import retrieve                             # noqa: E402
from app.retrieval.query_builder import (MIN_CONFIDENT_CONCEPTS, _glossary_is_confident,  # noqa: E402
                                         distill_query)

SIN_CAMBIO, AHORA_DISTILA, YA_NO_DISTILA = "igual", "ahora distila", "ya no distila"


def clasificar(caso: dict) -> dict:
    q = resolve_concepts(caso["query"], caso["especie"])
    vieja_distila = len(q.concepts) < MIN_CONFIDENT_CONCEPTS
    nueva_distila = not _glossary_is_confident(q.concepts)   # la regla REAL, no una copia
    if vieja_distila == nueva_distila:
        cambio = SIN_CAMBIO
    else:
        cambio = AHORA_DISTILA if nueva_distila else YA_NO_DISTILA
    return {"id": caso["id"], "mesh_target": caso["mesh_target"], "cambio": cambio,
            "n_conceptos": len(q.concepts), "concepts": q.concepts,
            "vieja_distila": vieja_distila, "nueva_distila": nueva_distila}


def _con_regla(caso: dict, distilar: bool) -> StructuredQuery:
    """Construye la query como lo haría cada regla (distilando o no), sin tocar build_query."""
    q = resolve_concepts(caso["query"], caso["especie"])
    if not distilar:
        return q
    concepts, mesh = distill_query(caso["query"], caso["especie"])
    if not concepts and not mesh:
        return q
    return q.model_copy(update={"concepts": list(dict.fromkeys([*q.concepts, *concepts])),
                                "mesh": list(dict.fromkeys([*q.mesh, *mesh])), "distilled": True})


def medir(caso: dict, fila: dict, k: int) -> dict:
    """Corre el retrieval con AMBAS reglas y compara si el target aparece y en qué puesto."""
    out = {"id": caso["id"], "mesh_target": caso["mesh_target"], "cambio": fila["cambio"]}
    for etiqueta, distilar in (("vieja", fila["vieja_distila"]), ("nueva", fila["nueva_distila"])):
        chunks, passed = retrieve(_con_regla(caso, distilar))
        marcas = [caso["mesh_target"] in (c.metadata.get("mesh") or []) for c in chunks[:k]]
        out[etiqueta] = {"hit": any(marcas), "aciertos": sum(marcas),
                         "primer_rank": next((i + 1 for i, m in enumerate(marcas) if m), None)}
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--retrieval", action="store_true", help="medir hit@k en los casos que cambian")
    ap.add_argument("--k", type=int, default=15)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    casos = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8"))
    filas = [clasificar(c) for c in casos]
    por_cambio = {}
    for f in filas:
        por_cambio.setdefault(f["cambio"], []).append(f)

    print(f"casos: {len(filas)}")
    for k in (SIN_CAMBIO, AHORA_DISTILA, YA_NO_DISTILA):
        print(f"  {k:<14} {len(por_cambio.get(k, [])):>4}")
    print("\nYA NO DISTILA (el glosario ya nombro la condicion: se ahorra la llamada al LLM):")
    for f in por_cambio.get(YA_NO_DISTILA, [])[:20]:
        print(f"  {f['id'][:34]:<34} {f['n_conceptos']} concepto(s): {', '.join(f['concepts'][:4])}")
    print("\nAHORA DISTILA (solo habia signos: se gana la inferencia del sindrome):")
    for f in por_cambio.get(AHORA_DISTILA, [])[:20]:
        print(f"  {f['id'][:34]:<34} {f['n_conceptos']} signo(s): {', '.join(f['concepts'][:4])}")

    if not args.retrieval:
        return

    cambian = [f for f in filas if f["cambio"] != SIN_CAMBIO]
    por_id = {c["id"]: c for c in casos}
    log(f"\nmidiendo retrieval en los {len(cambian)} casos que cambian (2 corridas cada uno)...")
    res = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(medir, por_id[f["id"]], f, args.k): f for f in cambian}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                res.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} fallo: {e}")
            if i % 5 == 0:
                log(f"  {i}/{len(cambian)}")

    print(f"\n{'caso':<34} {'cambio':<14} {'vieja':>14} {'nueva':>14}")
    print("-" * 80)
    mejor = peor = igual = 0
    for r in sorted(res, key=lambda x: x["id"]):
        v, n = r["vieja"], r["nueva"]
        vs = f"{'HIT@' + str(v['primer_rank']) if v['hit'] else 'sin hit':>14}"
        ns = f"{'HIT@' + str(n['primer_rank']) if n['hit'] else 'sin hit':>14}"
        print(f"{r['id'][:34]:<34} {r['cambio']:<14} {vs} {ns}")
        if n["aciertos"] > v["aciertos"]:
            mejor += 1
        elif n["aciertos"] < v["aciertos"]:
            peor += 1
        else:
            igual += 1
    print(f"\nen los casos que cambian: MEJORA {mejor}  EMPEORA {peor}  igual {igual}")
    hv = sum(1 for r in res if r["vieja"]["hit"])
    hn = sum(1 for r in res if r["nueva"]["hit"])
    print(f"hit@{args.k}: vieja {hv}/{len(res)}  ->  nueva {hn}/{len(res)}")
    json.dump(res, open(os.path.join(SCRATCH, "ab_decision_diff.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)


if __name__ == "__main__":
    main()
