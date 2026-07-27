# -*- coding: utf-8 -*-
"""Tercera (y última) hipótesis para la abstención: un JUEZ semántico con el LLM liviano.

Las dos anteriores murieron con datos:
  1. Umbral sobre el score determinístico -> imposible: mediana 1.701 en positivos y 1.700 en
     negativos. El score está saturado por constantes, no mide pertinencia.
  2. Umbral sobre el score del reranker -> 0.532 vs 0.499: cortar ahí silencia tantos casos buenos
     como malos atrapa.

La razón de fondo: en un corpus veterinario de 520k chunks SIEMPRE hay algo temáticamente
plausible. La similitud no distingue "trata este tema" de "responde esta pregunta". Eso es un
juicio semántico, y para eso hace falta leer.

Este script mide si el juez SÍ separa, sobre el mismo banco: 145 positivos (el corpus puede
responder) y 42 negativos (cobertura ~nula). Mide también la latencia: el juez estaría en la ruta
crítica del chat.
"""
import json, os, statistics, sys, time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))  # datos del banco, junto a estos scripts
BASE = os.path.dirname(os.path.dirname(SCRATCH))  # scripts/calidad -> athos-service
sys.path.insert(0, BASE); os.chdir(BASE)

from app.config import get_settings              # noqa: E402
from app.generation.llm_client import LLMClient  # noqa: E402
from app.retrieval.cascade import retrieve       # noqa: E402
from app.retrieval.query_builder import _extract_json, build_query  # noqa: E402

PASAJES = 6      # cuántos chunks ve el juez (los mejores tras el rerank)
CHARS = 700      # recorte por pasaje: alcanza para saber de qué trata

SYSTEM = (
    "Eres el control de calidad de un sistema RAG veterinario. Te doy la CONSULTA de un "
    "veterinario (en español) y los PASAJES de literatura que el buscador recuperó (en inglés).\n"
    "Tu única tarea: decidir si esos pasajes permiten FUNDAMENTAR una respuesta a esa consulta.\n"
    "Sé ESTRICTO. NO alcanza con que los pasajes:\n"
    "  - sean de la misma especie (perro/gato),\n"
    "  - hablen del mismo aparato o sistema en general,\n"
    "  - mencionen alguno de los signos de forma incidental.\n"
    "Alcanza SOLO si tratan la CONDICIÓN o el PROBLEMA concreto que plantea la consulta, de forma "
    "que un veterinario pudiera citarlos como respaldo.\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"puntaje": 0-10, "cubre": true|false, "motivo": "una frase"}\n'
    "puntaje 0-2 = los pasajes no tienen que ver con la consulta; 3-5 = tocan el tema de refilón "
    "(misma especie o sistema) pero no la condición; 6-8 = tratan la condición; 9-10 = la tratan "
    "de lleno y con detalle clínico útil."
)


def juzgar(pregunta, chunks, modelo):
    pasajes = "\n\n".join(
        f"[{i+1}] {(c.content or '')[:CHARS]}" for i, c in enumerate(chunks[:PASAJES]))
    user = f"CONSULTA:\n{pregunta.strip()[:2500]}\n\nPASAJES RECUPERADOS:\n{pasajes}"
    t0 = time.time()
    raw = LLMClient(model=modelo).complete(SYSTEM, user, max_tokens=300)
    dt = time.time() - t0
    d = _extract_json(raw) or {}
    p = d.get("puntaje")
    return (float(p) if isinstance(p, (int, float)) else None), bool(d.get("cubre")), dt


def medir(caso, modelo):
    q = build_query(caso["query"], caso["especie"])
    chunks, _ = retrieve(q)
    puntaje, cubre, dt = juzgar(caso["query"], chunks, modelo)
    return {"id": caso["id"], "negativo": bool(caso.get("negativo")),
            "puntaje": puntaje, "cubre": cubre, "seg_juez": round(dt, 2)}


def main():
    def log(m): print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)
    modelo = get_settings().llm_light_model
    pos = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8"))
    neg = json.load(open(os.path.join(BASE, "tests", "golden", "ampliado_negativos.json"), encoding="utf-8"))
    todos = pos + neg
    log(f"juez = {modelo} | {len(pos)} positivos + {len(neg)} negativos")

    filas = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(medir, c, modelo): c for c in todos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 40 == 0:
                log(f"  {i}/{len(todos)}")
    json.dump(filas, open(os.path.join(SCRATCH, "juez_abstencion.json"), "w",
                          encoding="utf-8"), ensure_ascii=False, indent=1)

    P = [f for f in filas if not f["negativo"] and f["puntaje"] is not None]
    N = [f for f in filas if f["negativo"] and f["puntaje"] is not None]
    log(f"\nevaluados: {len(P)} positivos, {len(N)} negativos")
    log(f"puntaje POSITIVOS: mediana {statistics.median(f['puntaje'] for f in P):.1f}")
    log(f"puntaje NEGATIVOS: mediana {statistics.median(f['puntaje'] for f in N):.1f}")
    lat = [f["seg_juez"] for f in filas if f.get("seg_juez")]
    log(f"latencia del juez: mediana {statistics.median(lat):.1f}s  p90 {sorted(lat)[int(len(lat)*0.9)-1]:.1f}s")
    log(f"campo 'cubre': positivos {sum(f['cubre'] for f in P)}/{len(P)} | "
        f"negativos {sum(f['cubre'] for f in N)}/{len(N)}")

    print(f"\n{'umbral':>7}  {'RESPONDE positivos (alto=bien)':>31}  {'RESPONDE negativos (bajo=bien)':>31}")
    print("-" * 76)
    for u in range(1, 10):
        rp = sum(1 for f in P if f["puntaje"] >= u)
        rn = sum(1 for f in N if f["puntaje"] >= u)
        print(f"{u:7d}  {rp}/{len(P)} ({rp/len(P):>5.0%})".ljust(42)
              + f"  {rn}/{len(N)} ({rn/len(N):>5.0%})")


if __name__ == "__main__":
    main()
