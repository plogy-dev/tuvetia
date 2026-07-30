# -*- coding: utf-8 -*-
"""Calibra el juez de evidencia contra el banco de negativos VALIDADO. Solo lectura.

Por qué existe: hasta el 2026-07-29 la abstención se medía contra un banco donde **24 de 42
"negativos" tenían literatura de sobra** (ver `negativos_validar.py`). Con ese instrumento, cualquier
número era ruido — y de hecho llevó a adoptar y revertir `JUDGE_MODEL` en el mismo día.

Este script mide el juez sobre los **18 negativos reales** (donde abstenerse es lo correcto) y sobre
una muestra de positivos (donde abstenerse es un error), en la MISMA corrida y con los mismos casos
para cada configuración. Eso convierte la comparación en pareada: la diferencia que quede es del
juez, no de la muestra.

Reporta las dos caras que hay que equilibrar:
  aciertos   = negativos donde se abstiene o declara evidencia limitada
  daño       = positivos donde se abstiene teniendo literatura (sobre-abstención)

Uso:
  python scripts/calidad/juez_calibrar.py --modelos "" --modelos deepseek-v4-pro --n-pos 16
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

from app.chat import CHAT_LIT_LIMIT  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.generation import evidence_judge as ej  # noqa: E402
from app.retrieval.cascade import build_and_retrieve  # noqa: E402
from scripts.calidad.respuestas_eval import _muestra  # noqa: E402


def _recupera(caso: dict) -> tuple[list, bool]:
    _q, chunks, passed = build_and_retrieve(caso["query"], caso.get("especie"))
    return chunks[:CHAT_LIT_LIMIT], passed


def juzga_con(modelo: str, pregunta: str, lit: list) -> tuple[str, float | None, float]:
    """Corre el juez forzando un modelo concreto ('' = el del env)."""
    original = get_settings().judge_model
    try:
        # `judge_model_name` es una property sobre el settings cacheado: se sobreescribe el campo.
        object.__setattr__(get_settings(), "judge_model", modelo)
        v = ej.judge_evidence(pregunta, lit)
        return v.band, v.score, v.seconds
    finally:
        object.__setattr__(get_settings(), "judge_model", original)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--modelos", action="append", default=None,
                    help='repetible; "" = el del env (liviano)')
    ap.add_argument("--n-pos", type=int, default=16)
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    modelos = args.modelos if args.modelos is not None else ["", "deepseek-v4-pro"]

    def log(m):
        print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    banco_neg = os.path.join(BASE, "tests", "golden", "ampliado_negativos_validado.json")
    if not os.path.exists(banco_neg):
        print("falta el banco validado: corré primero negativos_validar.py")
        return
    negativos = json.load(open(banco_neg, encoding="utf-8"))
    positivos = _muestra(json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"),
                                        encoding="utf-8")), args.n_pos)
    casos = [(c, True) for c in negativos] + [(c, False) for c in positivos]
    log(f"{len(negativos)} negativos VALIDADOS + {len(positivos)} positivos; "
        f"modelos: {[m or '(env/liviano)' for m in modelos]}")

    # El retrieval se hace UNA vez por caso y se reusa para todos los modelos: así la comparación es
    # pareada y además no se paga el retrieval N veces.
    def evalua(caso: dict, es_neg: bool) -> dict:
        lit, passed = _recupera(caso)
        fila = {"id": caso["id"], "negativo": es_neg, "passed": passed, "n_lit": len(lit)}
        for m in modelos:
            band, score, seg = juzga_con(m, caso["query"], lit if passed else [])
            fila[m or "env"] = {"banda": band, "puntaje": score, "seg": round(seg, 1)}
        return fila

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(evalua, c, neg): c for c, neg in casos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 10 == 0:
                log(f"  {i}/{len(casos)}")

    neg = [f for f in filas if f["negativo"]]
    pos = [f for f in filas if not f["negativo"]]
    print("\n" + "=" * 92)
    print("JUEZ DE EVIDENCIA — banco de negativos VALIDADO (comparación pareada)")
    print("=" * 92)
    print(f"{'modelo':22} {'acierta en neg':>16} {'sobre-abstiene':>16} {'latencia':>10}")
    print("-" * 92)
    for m in modelos:
        k = m or "env"
        aciertos = sum(1 for f in neg if f[k]["banda"] in ("none", "limited"))
        abstiene_neg = sum(1 for f in neg if f[k]["banda"] == "none")
        sobre = sum(1 for f in pos if f[k]["banda"] == "none")
        lat = statistics.median([f[k]["seg"] for f in filas])
        print(f"{(m or '(env/liviano)'):22} {aciertos:>7}/{len(neg)} ({aciertos / len(neg):.0%})"
              f" {sobre:>8}/{len(pos)} ({sobre / max(len(pos), 1):.0%})   {lat:>7.1f}s")
        print(f"{'':22}   de los cuales abstención dura: {abstiene_neg}")

    print("\n  DESACUERDOS entre modelos (donde la elección importa):")
    if len(modelos) >= 2:
        a, b = modelos[0] or "env", modelos[1] or "env"
        for f in filas:
            if f[a]["banda"] != f[b]["banda"]:
                tipo = "NEG" if f["negativo"] else "POS"
                print(f"    [{tipo}] {f['id']:38} {a}={f[a]['banda']}({f[a]['puntaje']})  "
                      f"{b}={f[b]['banda']}({f[b]['puntaje']})")

    out = os.path.join(SCRATCH, "juez_calibracion.json")
    json.dump(filas, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  -> {out}")


if __name__ == "__main__":
    main()
