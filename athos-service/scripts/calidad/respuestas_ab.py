# -*- coding: utf-8 -*-
"""A/B de prompts de redacción sobre los MISMOS casos y la MISMA literatura. Solo lectura.

Por qué así: el retrieval es lo más caro y lento del pipeline, y comparar dos prompts sobre
recuperaciones distintas mezclaría dos efectos. Acá se recupera UNA vez por caso y las dos
variantes redactan sobre esa misma literatura — la diferencia que quede es del prompt.

El juez es el mismo de `respuestas_eval.py` (rúbrica de clínico experimentado) y califica las dos
respuestas del mismo caso en el MISMO llamado, obligándolo a elegir cuál seguiría un veterinario.
Comparar dos respuestas entre sí es más fiable que puntuarlas por separado.

Uso:
  python scripts/calidad/respuestas_ab.py --a actual --b clinico --n 16 \
         --juez-modelo deepseek-v4-pro --juez-proveedor openai
"""
import argparse
import json
import os
import re
import statistics
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.chat import CHAT_LIT_LIMIT, CHAT_MAX_TOKENS, _chat_prompt  # noqa: E402
from app.generation.evidence_judge import judge_evidence  # noqa: E402
from app.generation.llm_client import LLMClient  # noqa: E402
from app.models import PatientContext  # noqa: E402
from app.retrieval.cascade import build_and_retrieve  # noqa: E402
from scripts.calidad.prompts_variantes import VARIANTES  # noqa: E402
from scripts.calidad.respuestas_eval import (  # noqa: E402
    _PASSAGE_CHARS, _judge_client, _muestra, _parse_json)

COMPARA_SYSTEM = (
    "Eres un profesor de clínica veterinaria con décadas de experiencia. Dos asistentes "
    "respondieron la MISMA consulta con la MISMA literatura disponible. Decide cuál sirve más a un "
    "veterinario que tiene al paciente delante, y sé exigente con ambas.\n"
    "Criterios, en orden de importancia:\n"
    "1. FIDELIDAD: ¿lo que afirma con cita [n] está realmente en el pasaje n? Afirmar cosas "
    "(sobre todo fármacos, dosis o cifras) sin respaldo, o generalizar un caso único, es lo más "
    "grave que puede hacer.\n"
    "2. UTILIDAD CLÍNICA: diferenciales priorizados, el siguiente paso diagnóstico CONCRETO, "
    "criterios de urgencia o derivación. Una respuesta correcta pero genérica vale poco.\n"
    "3. SEGURIDAD: lenguaje de posibilidad, sin dosis si faltan datos, alarmas a tiempo.\n"
    "4. HONESTIDAD sobre los límites de la evidencia.\n"
    "Devuelve SOLO JSON válido, sin ```:\n"
    '{"ganadora": "A"|"B"|"empate", "motivo": "una frase concreta", '
    '"A": {"fidelidad": 0-10, "utilidad": 0-10, "seguridad": 0-10, "confiaria": true|false, '
    '"afirmaciones_sin_respaldo": ["..."]}, '
    '"B": {"fidelidad": 0-10, "utilidad": 0-10, "seguridad": 0-10, "confiaria": true|false, '
    '"afirmaciones_sin_respaldo": ["..."]}}'
)

JUDGE: LLMClient | None = None


def _comparar_user(question: str, literature, resp_a: str, resp_b: str) -> str:
    pasajes = "\n\n".join(
        f"[{i}] fuente={c.source or '?'}\n{(c.content or '')[:_PASSAGE_CHARS]}"
        for i, c in enumerate(literature, 1)) or "(sin literatura)"
    return (f"CONSULTA:\n{question.strip()[:2500]}\n\nLITERATURA DISPONIBLE:\n{pasajes}\n\n"
            f"RESPUESTA A:\n{resp_a.strip()}\n\nRESPUESTA B:\n{resp_b.strip()}")


def _rama(spec: str) -> tuple[str, str | None, str | None]:
    """Interpreta una rama del A/B: variante de PROMPT o especificación de MODELO.

    - "clinico"                  -> compara PROMPTS con el redactor de producción (lo de siempre)
    - "gemini-3.6-flash@google"  -> compara MODELOS con el prompt de producción

    Lo segundo es lo que pide el ítem 2.5 del contrato (pruebas comparativas de calidad entre
    modelos), y estuvo bloqueado hasta el 30-jul porque sólo había un proveedor con el que comparar.
    Devuelve (variante_de_prompt, modelo, proveedor).
    """
    if "@" in spec:
        modelo, _, proveedor = spec.partition("@")
        return "actual", modelo.strip(), proveedor.strip().lower()
    return spec, None, None


def evaluar_caso(caso: dict, nombre_a: str, nombre_b: str) -> dict | None:
    query, chunks, passed = build_and_retrieve(caso["query"], caso.get("especie"))
    literature = chunks[:CHAT_LIT_LIMIT]
    verdict = judge_evidence(caso["query"], literature if passed else [])
    if (not passed) or verdict.abstains:
        return None      # abstiene: no hay redacción que comparar (el prompt no interviene)

    paciente = PatientContext(patient_id="", species=caso.get("especie"))
    user = _chat_prompt(caso["query"], literature, paciente, [])
    resp = {}
    for nombre in (nombre_a, nombre_b):
        # Cada rama puede ser una variante de prompt (mismo modelo) o un modelo distinto (mismo
        # prompt). En los dos casos la LITERATURA es la misma: el retrieval corrió una sola vez
        # arriba, así que la diferencia que quede es de lo que se está comparando y no del azar
        # de la recuperación.
        variante, modelo, proveedor = _rama(nombre)
        redactor = LLMClient(model=modelo, provider=proveedor)
        resp[nombre] = redactor.complete(VARIANTES[variante], user, max_tokens=CHAT_MAX_TOKENS)

    raw = JUDGE.complete(
        COMPARA_SYSTEM,
        _comparar_user(caso["query"], literature, resp[nombre_a], resp[nombre_b]),
        max_tokens=900)
    fallo = _parse_json(raw)
    fila = {"id": caso["id"], "banda": verdict.band,
            "resp_a": resp[nombre_a], "resp_b": resp[nombre_b],
            "citas_a": len(set(re.findall(r"\[(\d+)\]", resp[nombre_a]))),
            "citas_b": len(set(re.findall(r"\[(\d+)\]", resp[nombre_b])))}
    if fallo:
        fila["fallo"] = fallo
    else:
        fila["fallo_error"] = raw[:300]
    return fila


def main() -> None:
    ap = argparse.ArgumentParser()
    # Sin `choices`: una rama puede ser una variante de prompt o un "modelo@proveedor".
    ap.add_argument("--a", default="actual",
                    help=f"variante de prompt ({', '.join(sorted(VARIANTES))}) o modelo@proveedor")
    ap.add_argument("--b", default="clinico",
                    help="idem; p. ej. gemini-3.6-flash@google para comparar MODELOS")
    ap.add_argument("--n", type=int, default=16)
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--juez-modelo", default=None)
    ap.add_argument("--juez-proveedor", default=None, choices=("anthropic", "openai"))
    args = ap.parse_args()

    global JUDGE
    JUDGE = _judge_client(args.juez_modelo, args.juez_proveedor)

    def log(m):
        print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    casos = _muestra(json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"),
                                    encoding="utf-8")), args.n)
    log(f"A={args.a}  B={args.b}  {len(casos)} casos  redactor={LLMClient().model}  "
        f"juez={JUDGE.model}")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(evaluar_caso, c, args.a, args.b): c for c in casos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                r = fut.result()
                if r:
                    filas.append(r)
            except Exception as e:  # noqa: BLE001
                log(f"  caso {futs[fut]['id']} falló: {e}")
            if i % 4 == 0:
                log(f"  {i}/{len(casos)}")

    juzgadas = [f for f in filas if "fallo" in f]
    print("=" * 78)
    print(f"A/B DE PROMPT — A={args.a}  vs  B={args.b}   ({len(juzgadas)} casos comparados)")
    print("=" * 78)
    if not juzgadas:
        print("  sin casos juzgados")
        return

    ganadas = {"A": 0, "B": 0, "empate": 0}
    for f in juzgadas:
        ganadas[f["fallo"].get("ganadora", "empate")] = \
            ganadas.get(f["fallo"].get("ganadora", "empate"), 0) + 1
    print(f"  gana A ({args.a}): {ganadas['A']}   gana B ({args.b}): {ganadas['B']}   "
          f"empate: {ganadas['empate']}")

    for dim in ("fidelidad", "utilidad", "seguridad"):
        va = [f["fallo"]["A"][dim] for f in juzgadas if dim in f["fallo"].get("A", {})]
        vb = [f["fallo"]["B"][dim] for f in juzgadas if dim in f["fallo"].get("B", {})]
        if va and vb:
            print(f"  {dim:12}  A {statistics.mean(va):.1f}   B {statistics.mean(vb):.1f}   "
                  f"(mediana A {statistics.median(va):.1f} / B {statistics.median(vb):.1f})")
    for lado, nombre in (("A", args.a), ("B", args.b)):
        conf = sum(1 for f in juzgadas if f["fallo"].get(lado, {}).get("confiaria"))
        sinresp = sum(1 for f in juzgadas if f["fallo"].get(lado, {}).get("afirmaciones_sin_respaldo"))
        citas = statistics.median(f[f"citas_{lado.lower()}"] for f in juzgadas)
        print(f"  {nombre:10}: confiaría {conf}/{len(juzgadas)}   "
              f"con afirmaciones sin respaldo {sinresp}/{len(juzgadas)}   citas(mediana) {citas}")

    print("\n  motivos del fallo:")
    for f in juzgadas[:12]:
        print(f"    {f['id']:26} {f['fallo'].get('ganadora', '?'):7} "
              f"{str(f['fallo'].get('motivo', ''))[:90]}")

    out = os.path.join(SCRATCH, f"ab_{args.a}_vs_{args.b}.json")
    json.dump(filas, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  -> {out}")


if __name__ == "__main__":
    main()
