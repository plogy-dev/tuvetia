# -*- coding: utf-8 -*-
"""Calibra la abstención con un ROC honesto: POSITIVOS vs NEGATIVOS.

POSITIVOS = los 146 casos del golden ampliado (condiciones con 100-1.700 chunks: el corpus SÍ
            puede responder). Athos debe responder.
NEGATIVOS = consultas sobre condiciones con cobertura ~nula (1-3 chunks) o ausentes del corpus.
            Athos DEBE abstenerse.

Mide varias señales candidatas para decidir, y muestra cuál separa de verdad:
  det_max        : el score determinístico actual (max chunk.score) -> el que hoy nunca frena nada
  rerank_top     : mejor score del reranker
  rerank_p3      : 3er mejor score (¿hay VARIOS documentos pertinentes, no uno de casualidad?)
  mesh_no_especie: ¿algún chunk comparte un MeSH de la consulta que NO sea de especie?
"""
import json, os, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

from app.config import get_settings                       # noqa: E402
from app.generation.llm_client import LLMClient           # noqa: E402
from app.retrieval.cascade import SPECIES_MESH, retrieve  # noqa: E402
from app.retrieval.query_builder import _extract_json, build_query  # noqa: E402

NEG_JSON = os.path.join(BASE, "tests", "golden", "ampliado_negativos.json")
ESPECIE_MESH = {m for v in SPECIES_MESH.values() for m in v} | {"Animals", "Dogs", "Cats"}

SYSTEM = (
    "Eres un veterinario clínico en Latinoamérica. Te doy una condición (descriptor MeSH en "
    "inglés). Escribí la TRANSCRIPCIÓN de una consulta real de PEQUEÑOS ANIMALES donde el paciente "
    "la tiene.\n - Diálogo 'Veterinario:' / 'Dueño:', español neutro, 6 a 10 turnos.\n"
    " - El dueño habla llano; el veterinario describe hallazgos con lenguaje de posibilidad.\n"
    " - NO escribas el descriptor en inglés.\n"
    "Devolvé SOLO JSON: {\"especie\": \"perro|gato\", \"transcripcion\": \"Veterinario: ...\"}"
)


def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)


def generar(cond, modelo):
    raw = LLMClient(model=modelo).complete(SYSTEM, f"CONDICIÓN: {cond}", max_tokens=1100)
    d = _extract_json(raw) or {}
    t = str(d.get("transcripcion") or "").strip()
    if len(t) < 200:
        raise ValueError("inutilizable")
    return {"id": "neg-" + cond.lower().replace(" ", "-").replace(",", ""), "mesh_target": cond,
            "especie": (d.get("especie") or "perro").lower(), "query": t, "negativo": True}


def medir(caso):
    q = build_query(caso["query"], caso["especie"])
    chunks, passed = retrieve(q)
    consulta_mesh = {m for m in q.mesh if m not in ESPECIE_MESH}
    rs = sorted((c.metadata.get("rerank_score") for c in chunks
                 if c.metadata.get("rerank_score") is not None), reverse=True)
    mesh_ok = any(consulta_mesh & set(c.metadata.get("mesh") or []) for c in chunks)
    return {"id": caso["id"], "negativo": bool(caso.get("negativo")),
            "det_max": max((c.score for c in chunks), default=0.0),
            "rerank_top": rs[0] if rs else None,
            "rerank_p3": rs[2] if len(rs) > 2 else 0.0,
            "mesh_no_especie": mesh_ok, "passed_actual": passed}


def main():
    modelo = get_settings().llm_light_model
    negativos = json.load(open(NEG_JSON, encoding="utf-8")) if os.path.exists(NEG_JSON) else []
    ya = {n["mesh_target"] for n in negativos}

    flojas = []
    with open(os.path.join(SCRATCH, "corpus_mesh_clasificado.tsv"), encoding="utf-8") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if p[2] == "enfermedad" and 1 <= int(p[1]) <= 3 and p[0] not in ya:
                flojas.append(p[0])
    flojas = flojas[:34]
    log(f"genero {len(flojas)} negativos de condiciones con 1-3 chunks")
    with ThreadPoolExecutor(max_workers=5) as ex:
        for fut in as_completed({ex.submit(generar, c, modelo): c for c in flojas}):
            try:
                negativos.append(fut.result())
            except Exception:  # noqa: BLE001
                pass
    json.dump(negativos, open(NEG_JSON, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"{len(negativos)} negativos en total")

    positivos = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8"))
    todos = positivos + negativos
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
    json.dump(filas, open(os.path.join(SCRATCH, "roc_abstencion.json"), "w",
                          encoding="utf-8"), ensure_ascii=False, indent=1)

    pos = [f for f in filas if not f["negativo"]]
    neg = [f for f in filas if f["negativo"]]
    log(f"\nPOSITIVOS {len(pos)}  |  NEGATIVOS {len(neg)}")
    log(f"hoy responde: positivos {sum(f['passed_actual'] for f in pos)}/{len(pos)}, "
        f"negativos {sum(f['passed_actual'] for f in neg)}/{len(neg)}  <- deberia ser ~0")

    import statistics as st
    for campo in ("det_max", "rerank_top", "rerank_p3"):
        vp = [f[campo] for f in pos if f[campo] is not None]
        vn = [f[campo] for f in neg if f[campo] is not None]
        if vp and vn:
            log(f"{campo:16s} positivos med {st.median(vp):.3f} | negativos med {st.median(vn):.3f}")
    log(f"{'mesh_no_especie':16s} positivos {sum(f['mesh_no_especie'] for f in pos)}/{len(pos)} | "
        f"negativos {sum(f['mesh_no_especie'] for f in neg)}/{len(neg)}")

    print(f"\n{'señal':>16} {'umbral':>7}  {'responde POS (alto=bien)':>25}  {'responde NEG (bajo=bien)':>25}")
    print("-" * 80)
    for campo in ("rerank_top", "rerank_p3", "det_max"):
        for u in (0.10, 0.20, 0.30, 0.35, 0.40, 0.45, 0.50, 0.55, 0.60):
            vp = [f for f in pos if f[campo] is not None]
            vn = [f for f in neg if f[campo] is not None]
            if not vp or not vn:
                continue
            rp = sum(1 for f in vp if f[campo] >= u)
            rn = sum(1 for f in vn if f[campo] >= u)
            print(f"{campo:>16} {u:7.2f}  {rp}/{len(vp)} ({rp/len(vp):>5.0%})".ljust(56)
                  + f"  {rn}/{len(vn)} ({rn/len(vn):>5.0%})")
        print()


if __name__ == "__main__":
    main()
