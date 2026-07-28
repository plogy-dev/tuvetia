# -*- coding: utf-8 -*-
"""Verifica que la curación crítica del glosario SE TRADUZCA en literatura recuperada.

Sembrar un sinónimo no sirve de nada si el chunk correcto no termina arriba. Por cada consulta
veterinaria realista, corre el pipeline completo contra producción y pregunta al corpus: ¿alguno de
los chunks del top-k lleva el descriptor esperado en su `metadata->mesh`?

Uso: python scripts/calidad/criticos_verificar.py [--k 15]
"""
import argparse
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.glossary.resolve import resolve_concepts     # noqa: E402
from app.retrieval.cascade import retrieve            # noqa: E402
from app.retrieval.query_builder import build_query   # noqa: E402

CASOS = [
    ("rabia", "perro", ["Rabies", "Rabies virus"],
     "Perro sin vacunar que mordio a un chico, esta agresivo y saliva mucho. Puede ser rabia?"),
    ("leishmaniasis-visceral", "perro", ["Leishmaniasis", "Leishmaniasis, Visceral", "Leishmania infantum"],
     "Perro de zona endemica con adelgazamiento, lesiones en la piel y unas muy largas, sospecho leishmaniasis visceral"),
    ("dirofilariosis", "perro", ["Dirofilariasis", "Dirofilaria immitis"],
     "Perro con tos y se cansa al ejercicio, sospecho dirofilariosis"),
    ("moquillo", "perro", ["Distemper", "Distemper Virus, Canine"],
     "Cachorro sin vacunar con tos, secrecion en los ojos y convulsiones, sera moquillo?"),
    ("rabia-mordedura", "perro", ["Rabies", "Rabies virus"],
     "Me trajeron un perro que mordio a una persona, esta raro y no toma agua"),
]


def medir(caso, k):
    nombre, especie, objetivos, texto = caso
    glos = resolve_concepts(texto, especie)
    q = build_query(texto, especie)
    chunks, passed = retrieve(q)
    top = chunks[:k]
    aciertos = [c for c in top if set(objetivos) & set(c.metadata.get("mesh") or [])]
    primer = next((i + 1 for i, c in enumerate(top)
                   if set(objetivos) & set(c.metadata.get("mesh") or [])), None)
    return {"caso": nombre, "glosario": glos.concepts, "distilo": q.distilled, "passed": passed,
            "aciertos": len(aciertos), "primer": primer, "objetivos": objetivos}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--k", type=int, default=15)
    args = ap.parse_args()
    t0 = time.time()
    res = []
    with ThreadPoolExecutor(max_workers=2) as ex:
        futs = {ex.submit(medir, c, args.k): c for c in CASOS}
        for fut in as_completed(futs):
            try:
                res.append(fut.result())
            except Exception as e:  # noqa: BLE001
                print(f"  {futs[fut][0]} fallo: {e}", flush=True)

    print(f"\n{'caso':<24} {'glosario resuelve':<44} {'distilo':<8} {'top-' + str(args.k):>8}")
    print("-" * 92)
    for r in sorted(res, key=lambda x: x["caso"]):
        hit = f"{r['aciertos']} @{r['primer']}" if r["primer"] else "SIN HIT"
        print(f"{r['caso']:<24} {', '.join(r['glosario'])[:42]:<44} "
              f"{'si' if r['distilo'] else 'no':<8} {hit:>8}")
    ok = sum(1 for r in res if r["primer"])
    print(f"\ncon literatura del descriptor correcto en el top-{args.k}: {ok}/{len(res)}")
    print(f"({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
