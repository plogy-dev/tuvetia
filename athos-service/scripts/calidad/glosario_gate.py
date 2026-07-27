# -*- coding: utf-8 -*-
"""Gate reforzado del glosario. READ-ONLY sobre la DB.

Además del golden 11/11 (`eval_golden.py --retrieval-only`), mide el riesgo que el golden NO ve:
`MIN_CONFIDENT_CONCEPTS=3` hace que un glosario más rico SALTE la distilación con el LLM. Si una
consulta pasa de `distilled=True` a `distilled=False` y encima resuelve conceptos incidentales,
el retrieval puede empeorar sin que el golden lo note.

Por eso reporta, por caso: nº de conceptos resueltos SOLO por glosario y si distilaría.
Se corre ANTES y DESPUÉS de aprobar cada tanda y se comparan las dos salidas.

Uso: python glosario_gate.py --etiqueta antes|despues
"""
import argparse, json, os, sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

from app.glossary.resolve import clear_synonym_cache, resolve_concepts  # noqa: E402
from app.retrieval.query_builder import MIN_CONFIDENT_CONCEPTS  # noqa: E402

CASES = os.path.join(BASE, "tests", "golden", "cases.json")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--etiqueta", required=True)
    args = ap.parse_args()

    clear_synonym_cache()  # el TTL de 5 min no debe tapar el efecto de la tanda recién sembrada
    casos = json.load(open(CASES, encoding="utf-8"))["cases"]
    filas = []
    print(f"{'caso':30s} {'conceptos':>9s} {'distila':>8s}   mesh resueltos por glosario")
    print("-" * 100)
    for c in casos:
        q = resolve_concepts(c["query"], c["species"])
        distila = len(q.concepts) < MIN_CONFIDENT_CONCEPTS
        filas.append({"id": c["id"], "n_conceptos": len(q.concepts), "distila": distila,
                      "concepts": q.concepts, "mesh": q.mesh})
        print(f"{c['id']:30s} {len(q.concepts):9d} {str(distila):>8s}   {q.mesh[:6]}")
    n_distila = sum(1 for f in filas if f["distila"])
    print("-" * 100)
    print(f"casos que aún distilan (piden ayuda al LLM): {n_distila}/{len(filas)}")
    print(f"conceptos promedio por caso: {sum(f['n_conceptos'] for f in filas)/len(filas):.1f}")

    out = os.path.join(SCRATCH, f"gate_glosario_{args.etiqueta}.json")
    json.dump(filas, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"-> {out}")

    otro = os.path.join(SCRATCH, "gate_glosario_antes.json")
    if args.etiqueta == "despues" and os.path.exists(otro):
        antes = {f["id"]: f for f in json.load(open(otro, encoding="utf-8"))}
        print("\nCAMBIOS vs antes:")
        alarma = False
        for f in filas:
            a = antes.get(f["id"])
            if not a:
                continue
            if a["distila"] and not f["distila"]:
                alarma = True
                nuevos = [c for c in f["concepts"] if c not in a["concepts"]]
                print(f"  !! {f['id']}: DEJÓ de distilar ({a['n_conceptos']}->{f['n_conceptos']} "
                      f"conceptos). Nuevos: {nuevos[:8]}")
            elif f["n_conceptos"] != a["n_conceptos"]:
                print(f"     {f['id']}: {a['n_conceptos']}->{f['n_conceptos']} conceptos")
        if not alarma:
            print("  ningún caso dejó de distilar — sin regresión por MIN_CONFIDENT_CONCEPTS")
        else:
            print("\n  REVISAR: un caso que dejó de distilar puede perder el síndrome que el LLM "
                  "infería. Verificar que el golden siga en 11/11 y que los conceptos nuevos sean "
                  "del cuadro real, no incidentales.")


if __name__ == "__main__":
    main()
