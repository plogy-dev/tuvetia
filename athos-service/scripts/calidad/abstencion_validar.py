# -*- coding: utf-8 -*-
"""Validación de la ABSTENCIÓN YA IMPLEMENTADA (a diferencia de abstencion_juez.py, que sólo medía).

Corre el pipeline real —build_query -> retrieve -> `app.generation.evidence_judge.judge_evidence`—
sobre el banco del repo y reporta la matriz que importa:

  falsos silencios : positivos que caen en banda `none` (Athos se calla teniendo con qué responder)
  atajados         : negativos que caen en banda `none` (para eso existe la abstención)

Recordá que las etiquetas del banco tienen ruido conocido (ver `docs/` y la bitácora): miden "¿el
corpus CONTIENE esto?", mientras que el juez mide "¿los pasajes RECUPERADOS cubren la consulta?" —
que es justo lo que debe decidir. Los positivos que el retrieval nunca trae (Distemper, Lymphoma,
Tick Infestations) puntúan bajo con razón, y varios negativos están cubiertos bajo otro descriptor.
Sirve para detectar REGRESIONES (cambio de prompt, de modelo, de cortes), no como verdad absoluta.

Uso:
  python scripts/calidad/abstencion_validar.py            # muestra de 12 + 12
  python scripts/calidad/abstencion_validar.py --n 0      # banco completo (187 casos, ~US$ y minutos)
"""
import argparse
import json
import os
import statistics
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.config import get_settings                     # noqa: E402
from app.generation.evidence_judge import judge_evidence  # noqa: E402
from app.models import EVIDENCE_LIMITED, EVIDENCE_NONE   # noqa: E402
from app.retrieval.cascade import retrieve               # noqa: E402
from app.retrieval.query_builder import build_query      # noqa: E402


def medir(caso: dict) -> dict:
    q = build_query(caso["query"], caso["especie"])
    chunks, passed = retrieve(q)
    v = judge_evidence(caso["query"], chunks)
    return {"id": caso["id"], "negativo": bool(caso.get("negativo")), "passed": passed,
            "banda": v.band, "puntaje": v.score, "juzgado": v.judged, "seg": v.seconds,
            "motivo": v.reason}


def muestra(casos: list, n: int) -> list:
    """Muestra determinística y esparcida (no los n primeros: el banco viene ordenado por tema)."""
    if n <= 0 or n >= len(casos):
        return casos
    paso = len(casos) / n
    return [casos[int(i * paso)] for i in range(n)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=12, help="casos por grupo (0 = todos)")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    g = os.path.join(BASE, "tests", "golden")
    pos = muestra(json.load(open(os.path.join(g, "ampliado.json"), encoding="utf-8")), args.n)
    neg = muestra(json.load(open(os.path.join(g, "ampliado_negativos.json"), encoding="utf-8")), args.n)
    s = get_settings()
    log(f"juez={s.judge_model_name} cortes: none<={s.judge_abstain_max} "
        f"limited<={s.judge_limited_max} | {len(pos)} positivos + {len(neg)} negativos")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(medir, c): c for c in pos + neg}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001 — un caso roto no invalida la validación
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 10 == 0:
                log(f"  {i}/{len(pos) + len(neg)}")

    P = [f for f in filas if not f["negativo"]]
    N = [f for f in filas if f["negativo"]]
    sin_juzgar = [f for f in filas if not f["juzgado"]]
    print()
    for grupo, filas_g in (("POSITIVOS", P), ("NEGATIVOS", N)):
        c = Counter(f["banda"] for f in filas_g)
        puntajes = [f["puntaje"] for f in filas_g if f["puntaje"] is not None]
        print(f"{grupo} ({len(filas_g)}): " + "  ".join(f"{b}={c[b]}" for b in
              ("none", "limited", "sufficient")) +
              (f"   | mediana {statistics.median(puntajes):.1f}" if puntajes else ""))
    if P:
        print(f"\nfalsos silencios (positivos abstenidos): "
              f"{sum(1 for f in P if f['banda'] == EVIDENCE_NONE)}/{len(P)}")
    if N:
        print(f"negativos atajados (abstenidos):          "
              f"{sum(1 for f in N if f['banda'] == EVIDENCE_NONE)}/{len(N)}")
        print(f"negativos marcados 'evidencia limitada':  "
              f"{sum(1 for f in N if f['banda'] == EVIDENCE_LIMITED)}/{len(N)}")
    lat = [f["seg"] for f in filas if f["seg"]]
    if lat:
        print(f"\nlatencia del juez: mediana {statistics.median(lat):.1f}s  máx {max(lat):.1f}s")
    if sin_juzgar:
        print(f"NO juzgados (fallaron abierto, se responde igual): {len(sin_juzgar)}")
    print(f"umbral determinístico `passed`: {sum(1 for f in filas if f['passed'])}/{len(filas)} "
          "(por eso hace falta el juez)")

    json.dump(filas, open(os.path.join(SCRATCH, "abstencion_validacion.json"), "w",
                          encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\ndetalle -> scripts/calidad/abstencion_validacion.json")


if __name__ == "__main__":
    main()
