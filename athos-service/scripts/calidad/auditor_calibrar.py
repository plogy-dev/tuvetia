# -*- coding: utf-8 -*-
"""Calibra el auditor de fidelidad de la NOTA (`transcript_fidelity`) contra verdad-de-terreno.

Por qué existe: el auditor se encendió con una calibración pobre — atrapaba 3 de 9 notas con invento —
y no había forma de saber si el problema era el prompt o el modelo. Este script lo separa.

Cómo, y esto es lo que lo hace barato: **reutiliza notas YA generadas** de una corrida del A/B
(`phantom_ab_*.json`), que traen el SOAP y además el veredicto del juez de calidad con la rúbrica
separada (`inventado_so` = hechos afirmados en S u O que la transcripción no contiene). Eso es la
verdad-de-terreno. Así se pueden probar N modelos de auditor sobre LAS MISMAS notas sin pagar una sola
generación, y la comparación es pareada de verdad.

Se mide a nivel de NOTA, no de afirmación: emparejar textos de afirmación entre dos jueces exige
alineación difusa y agrega ruido propio. La pregunta que importa es "¿el auditor levanta la mano en las
notas que tienen un invento?".

Uso:
  python scripts/calidad/auditor_calibrar.py --modelos deepseek-v4-flash,deepseek-v4-pro
"""
import argparse
import json
import os
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

import app.generation.transcript_fidelity as tf  # noqa: E402
from scripts.calidad.respuestas_eval import _muestra  # noqa: E402


def _notas_con_verdad(archivo: str, rama: str) -> list[dict]:
    """Saca de una corrida del A/B las notas y el veredicto del juez sobre S/O."""
    d = json.load(open(os.path.join(SCRATCH, archivo), encoding="utf-8"))
    banco = {c["id"]: c for c in _muestra(
        json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8")),
        10_000)}
    out = []
    for caso in d["casos"]:
        lado = caso.get(rama) or {}
        soap, rub = lado.get("soap"), lado.get("rubrica") or {}
        if not soap or "inventado_so" not in rub or caso["id"] not in banco:
            continue
        out.append({
            "id": caso["id"],
            "transcript": banco[caso["id"]]["query"],
            "subjective": soap.get("subjective", ""),
            "objective": soap.get("objective", ""),
            # Verdad-de-terreno: el juez de calidad leyó la nota entera y listó lo inventado en S/O.
            "tiene_invento": bool(rub.get("inventado_so")),
            "invento_juez": rub.get("inventado_so") or [],
        })
    return out


def _audita(nota: dict, modelo: str) -> dict:
    """Corre el auditor forzando el modelo. `llm_light_model` se lee de Settings en cada llamada, así
    que se pasa por argumento explícito en vez de mutar el global: acá corren varios modelos en
    paralelo y el swap se pisaría entre hilos."""
    t0 = time.monotonic()
    rep = tf.check_note_fidelity(nota["subjective"], nota["objective"], nota["transcript"],
                                model=modelo)
    return {"id": nota["id"], "modelo": modelo, "judged": rep.judged,
            "senaladas": rep.as_payload(), "n_claims": rep.n_claims,
            "seg": round(time.monotonic() - t0, 1),
            "tiene_invento": nota["tiene_invento"], "invento_juez": nota["invento_juez"]}


def _resumen(filas: list[dict], modelo: str) -> dict:
    f = [x for x in filas if x["modelo"] == modelo]
    juzgadas = [x for x in f if x["judged"]]
    # Matriz de confusión a nivel de nota, contra el veredicto del juez de calidad.
    vp = sum(1 for x in juzgadas if x["senaladas"] and x["tiene_invento"])
    fp = sum(1 for x in juzgadas if x["senaladas"] and not x["tiene_invento"])
    fn = sum(1 for x in juzgadas if not x["senaladas"] and x["tiene_invento"])
    vn = sum(1 for x in juzgadas if not x["senaladas"] and not x["tiene_invento"])
    return {
        "modelo": modelo, "n": len(f), "juzgadas": len(juzgadas),
        "vp": vp, "fp": fp, "fn": fn, "vn": vn,
        "precision": round(vp / (vp + fp), 2) if (vp + fp) else None,
        "recall": round(vp / (vp + fn), 2) if (vp + fn) else None,
        "afirmaciones": sum(len(x["senaladas"]) for x in juzgadas),
        "claims": sum(x["n_claims"] for x in juzgadas),
        "seg_mediana": statistics.median([x["seg"] for x in f]) if f else 0,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", default="phantom_ab_actual_vs_split.json")
    ap.add_argument("--rama", default="a", choices=("a", "b"))
    ap.add_argument("--modelos", default="deepseek-v4-flash,deepseek-v4-pro")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    modelos = [m.strip() for m in args.modelos.split(",") if m.strip()]
    notas = _notas_con_verdad(args.archivo, args.rama)
    con_invento = sum(1 for n in notas if n["tiene_invento"])
    print(f"[{time.strftime('%H:%M:%S')}] {len(notas)} notas reutilizadas de {args.archivo} "
          f"(rama {args.rama}) · {con_invento} con invento según el juez · modelos: {', '.join(modelos)}",
          flush=True)

    tareas = [(n, m) for m in modelos for n in notas]
    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(_audita, n, m): (n, m) for n, m in tareas}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                n, m = futs[fut]
                print(f"  {n['id']} con {m} falló: {e}", flush=True)
            if i % 20 == 0:
                print(f"  {i}/{len(tareas)}", flush=True)

    print("\n" + "=" * 86)
    print("CALIBRACIÓN DEL AUDITOR DE FIDELIDAD DE LA NOTA")
    print("=" * 86)
    print(f"  {'modelo':22} {'recall':>7} {'precis':>7} {'VP':>4} {'FP':>4} {'FN':>4} {'VN':>4} "
          f"{'señaladas':>10} {'seg':>6}")
    resumenes = []
    for m in modelos:
        r = _resumen(filas, m)
        resumenes.append(r)
        print(f"  {m:22} {str(r['recall']):>7} {str(r['precision']):>7} {r['vp']:>4} {r['fp']:>4} "
              f"{r['fn']:>4} {r['vn']:>4} {f'{r['afirmaciones']}/{r['claims']}':>10} "
              f"{r['seg_mediana']:>6.1f}")

    print("\n  Recall = de las notas que el juez dice que tienen un invento, cuántas levanta el auditor.")
    print("  Precisión = de las que el auditor señala, cuántas el juez confirma.")
    print("  Un FP no es necesariamente un error del auditor: puede ser un invento que el juez no vio.")

    mejor = max((r for r in resumenes if r["recall"] is not None),
                key=lambda r: (r["recall"] or 0) + (r["precision"] or 0), default=None)
    if mejor:
        print(f"\n  MEJOR BALANCE: {mejor['modelo']} (recall {mejor['recall']} · "
              f"precisión {mejor['precision']})")

    # Lo que el auditor se pierde: sirve para saber si el hueco es de prompt o de capacidad.
    for m in modelos:
        perdidas = [x for x in filas if x["modelo"] == m and x["judged"]
                    and not x["senaladas"] and x["tiene_invento"]]
        if perdidas:
            print(f"\n  LO QUE {m} SE PIERDE (primeros 5):")
            for x in perdidas[:5]:
                print(f"    {x['id']:30} {str(x['invento_juez'][0])[:88]}")

    destino = os.path.join(SCRATCH, "auditor_calibracion.json")
    json.dump({"resumen": resumenes, "filas": filas}, open(destino, "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)
    print(f"\n  -> {destino}")


if __name__ == "__main__":
    main()
