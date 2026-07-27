# -*- coding: utf-8 -*-
"""¿La señal de abstención ya existe y es GRATIS?

El pipeline ya verifica citas: `parse_note_response` descarta lo que el modelo no respalde con [n],
y el Fantasma marca `insufficient_evidence = not passed or not citations`. Si al redactar sobre
literatura que NO cubre la consulta el modelo cita menos (o nada), entonces la abstención honesta
sale de maquinaria que ya corre: CERO latencia extra y cero costo extra, frente a los 1,8s que
cuesta el juez semántico.

Esto mide exactamente eso sobre el mismo banco: 145 positivos vs 42 negativos.
"""
import json, os, statistics, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

from app.config import get_settings                                  # noqa: E402
from app.generation.generate import build_note_prompt, parse_note_response  # noqa: E402
from app.generation.llm_client import LLMClient                      # noqa: E402
from app.models import PatientContext                                # noqa: E402
from app.retrieval.cascade import retrieve                           # noqa: E402
from app.retrieval.query_builder import build_query                  # noqa: E402


def medir(caso):
    q = build_query(caso["query"], caso["especie"])
    chunks, passed = retrieve(q)
    patient = PatientContext(patient_id="bench", species=caso["especie"])
    system, user = build_note_prompt(caso["query"], chunks, patient, [])
    t0 = time.time()
    raw = LLMClient(model=get_settings().llm_model).complete(system, user, max_tokens=4000)
    dt = time.time() - t0
    soap, citations, _flag = parse_note_response(raw, chunks)
    return {"id": caso["id"], "negativo": bool(caso.get("negativo")),
            "n_citas": len(citations), "n_chunks": len(chunks),
            "assessment": (soap.assessment or "")[:200], "seg": round(dt, 1)}


def main():
    def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
    pos = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8"))
    neg = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado_negativos.json"), encoding="utf-8"))
    todos = pos + neg
    log(f"redactor = {get_settings().llm_model} | {len(pos)} positivos + {len(neg)} negativos")

    filas = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(medir, c): c for c in todos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 40 == 0:
                log(f"  {i}/{len(todos)}")
    json.dump(filas, open(os.path.join(SCRATCH, "citas_abstencion.json"), "w",
                          encoding="utf-8"), ensure_ascii=False, indent=1)

    P = [f for f in filas if not f["negativo"]]
    N = [f for f in filas if f["negativo"]]
    log(f"\npositivos {len(P)} | negativos {len(N)}")
    log(f"citas POSITIVOS: mediana {statistics.median(f['n_citas'] for f in P):.1f}  "
        f"cero citas: {sum(1 for f in P if f['n_citas'] == 0)}")
    log(f"citas NEGATIVOS: mediana {statistics.median(f['n_citas'] for f in N):.1f}  "
        f"cero citas: {sum(1 for f in N if f['n_citas'] == 0)}")

    print(f"\n{'min citas':>9}  {'RESPONDE positivos (alto=bien)':>31}  {'RESPONDE negativos (bajo=bien)':>31}")
    print("-" * 78)
    for u in range(1, 8):
        rp = sum(1 for f in P if f["n_citas"] >= u)
        rn = sum(1 for f in N if f["n_citas"] >= u)
        print(f"{u:9d}  {rp}/{len(P)} ({rp/len(P):>5.0%})".ljust(44)
              + f"  {rn}/{len(N)} ({rn/len(N):>5.0%})")


if __name__ == "__main__":
    main()
