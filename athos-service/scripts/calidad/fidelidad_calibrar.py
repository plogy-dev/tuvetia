# -*- coding: utf-8 -*-
"""Calibra el auditor de fidelidad de citas: mide cuánto descarta Y deja auditar cada descarte.

Por qué existe: la primera versión del auditor descartaba el 58% de las referencias, incluso en
respuestas bien fundamentadas. Un número agregado no alcanza para decidir si un umbral es correcto —
hay que poder LEER la afirmación y el pasaje y juzgar si el descarte estaba bien. Este script imprime
exactamente eso, para revisión humana, y de paso mide la tasa.

Reusa las respuestas ya generadas por `respuestas_eval.py` (no vuelve a llamar al redactor): así la
calibración compara umbrales sobre EL MISMO texto, que es lo único que hace comparables dos corridas.

Uso:
  python scripts/calidad/fidelidad_calibrar.py --entrada respuestas_final.json [--n 12] [--ver 6]
"""
import argparse
import json
import os
import re
import statistics
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.chat import CHAT_LIT_LIMIT  # noqa: E402
from app.generation.citation_fidelity import check_fidelity, extract_claims  # noqa: E402
from app.retrieval.cascade import build_and_retrieve  # noqa: E402


def _casos_por_id() -> dict:
    casos = {}
    for nombre in ("ampliado.json", "ampliado_negativos.json"):
        for c in json.load(open(os.path.join(BASE, "tests", "golden", nombre), encoding="utf-8")):
            casos[c["id"]] = c
    return casos


def audita(fila: dict, casos: dict) -> dict | None:
    caso = casos.get(fila["id"])
    if not caso or fila.get("abstuvo") or not fila.get("respuesta"):
        return None
    # Se re-recupera la literatura para poder mostrar el pasaje citado junto a la afirmación.
    _q, chunks, _p = build_and_retrieve(caso["query"], caso.get("especie"))
    lit = chunks[:CHAT_LIT_LIMIT]
    rep = check_fidelity(fila["respuesta"], lit)
    claims = extract_claims(fila["respuesta"], len(lit))
    citadas = {n for c in claims for n in c.sources}
    # Para revisión humana: las afirmaciones que quedaron sin ninguna fuente viva.
    afectadas = [
        {"afirmacion": c.text[:300],
         "fuentes": list(c.sources),
         "pasajes": {n: (lit[n - 1].content or "")[:400] for n in c.sources if n <= len(lit)}}
        for c in claims if c.sources and set(c.sources) <= rep.unfaithful
    ]
    return {
        "id": fila["id"], "negativo": fila.get("negativo", False),
        "juzgado": rep.judged, "n_claims": rep.n_claims, "seg": round(rep.seconds, 1),
        "citadas": len(citadas), "descartadas": sorted(rep.unfaithful),
        "quedan": len(citadas - rep.unfaithful),
        "fundamentacion_juez": (fila.get("rubrica") or {}).get("fundamentacion"),
        "afirmaciones_sin_respaldo": afectadas,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--entrada", default="respuestas_final.json")
    ap.add_argument("--n", type=int, default=12)
    ap.add_argument("--ver", type=int, default=6, help="cuántos descartes imprimir para revisión")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    ruta = os.path.join(SCRATCH, args.entrada)
    filas = [f for f in json.load(open(ruta, encoding="utf-8"))
             if not f.get("abstuvo") and f.get("respuesta")][:args.n]
    casos = _casos_por_id()
    print(f"calibrando sobre {len(filas)} respuestas ya generadas ({args.entrada})\n")

    res = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(audita, f, casos): f for f in filas}
        for fut in as_completed(futs):
            try:
                r = fut.result()
            except Exception as e:  # noqa: BLE001
                print(f"  {futs[fut]['id']} falló: {e}")
                continue
            if r:
                res.append(r)

    juzgadas = [r for r in res if r["juzgado"]]
    if not juzgadas:
        print("el auditor no pudo juzgar ninguna (¿FIDELITY_ENABLED=false?)")
        return

    tot_citadas = sum(r["citadas"] for r in juzgadas)
    tot_caidas = sum(len(r["descartadas"]) for r in juzgadas)
    print("=" * 88)
    print("TASA DE DESCARTE")
    print("=" * 88)
    print(f"  respuestas auditadas          : {len(juzgadas)}/{len(res)}")
    print(f"  afirmaciones citadas (media)  : "
          f"{statistics.mean(r['n_claims'] for r in juzgadas):.1f}")
    print(f"  latencia del auditor (mediana): "
          f"{statistics.median(r['seg'] for r in juzgadas):.1f}s")
    print(f"  fuentes citadas / descartadas : {tot_citadas} / {tot_caidas}"
          f"   ({tot_caidas / max(tot_citadas, 1):.0%})")
    print(f"  respuestas que quedan SIN referencias: "
          f"{sum(1 for r in juzgadas if r['quedan'] == 0)}/{len(juzgadas)}")
    print(f"  respuestas intactas (0 descartes)    : "
          f"{sum(1 for r in juzgadas if not r['descartadas'])}/{len(juzgadas)}")

    print("\n  por caso (citadas -> quedan | fundamentación que le dio el juez de calidad):")
    for r in sorted(juzgadas, key=lambda x: -len(x["descartadas"])):
        marca = "  <-- REVISAR" if r["quedan"] == 0 and r["citadas"] else ""
        print(f"    {r['id']:34} {r['citadas']:2} -> {r['quedan']:2}   "
              f"F={r['fundamentacion_juez']}{marca}")

    print("\n" + "=" * 88)
    print(f"DESCARTES PARA REVISIÓN HUMANA (primeros {args.ver})")
    print("=" * 88)
    vistos = 0
    for r in juzgadas:
        for a in r["afirmaciones_sin_respaldo"]:
            if vistos >= args.ver:
                break
            vistos += 1
            print(f"\n--- {r['id']}  (fuentes {a['fuentes']} descartadas) ---")
            print(f"AFIRMACIÓN: {a['afirmacion']}")
            for n, txt in a["pasajes"].items():
                print(f"  PASAJE [{n}]: {re.sub(r'[ \t]+', ' ', txt)}")
        if vistos >= args.ver:
            break

    out = os.path.join(SCRATCH, "fidelidad_calibracion.json")
    json.dump(res, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  -> {out}")


if __name__ == "__main__":
    main()
