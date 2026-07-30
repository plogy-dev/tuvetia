# -*- coding: utf-8 -*-
"""Valida el banco de NEGATIVOS: ¿de verdad no hay literatura, o sólo falta el tag exacto?

Por qué existe. Los 42 negativos se eligieron por **ausencia del descriptor MeSH** en el corpus, y
eso resultó ser un criterio equivocado: al contrastarlos con un árbitro fuerte, en 5 de 10 revisados
**la literatura SÍ alcanzaba** — el corpus tiene el tema bajo otro descriptor (no hay `Impetigo` pero
sí `Pyoderma`; `Rheumatic Heart Disease` es un término humano y lo que hay es enfermedad valvular
canina, que es el cuadro real de la consulta). Con ese sesgo, la métrica "respondió con confianza sin
literatura" sobreestima el problema y **cualquier calibración de la abstención mide ruido**. Eso ya
costó una decisión revertida (`JUDGE_MODEL`, ver README §JUDGE_MODEL probado y revertido).

Qué hace: por cada negativo corre el retrieval REAL y le pregunta a un árbitro fuerte —distinto del
juez de producción— **una sola cosa**: con estos pasajes, ¿un veterinario podría fundamentar una
respuesta al caso? No evalúa ninguna respuesta, así que no arrastra el sesgo del redactor.

Salida: `ampliado_negativos_validado.json`, sólo con los casos que el árbitro confirma como sin
cobertura, más un informe de los que hay que reclasificar. Ese banco es el que permite medir la
abstención sin sesgo.

Uso:
  python scripts/calidad/negativos_validar.py [--n 0] [--juez-modelo deepseek-v4-pro]
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
from app.generation.evidence_judge import judge_evidence  # noqa: E402
from app.retrieval.cascade import build_and_retrieve  # noqa: E402
from scripts.calidad.respuestas_eval import _judge_client, _parse_json  # noqa: E402

ARBITRO_SYSTEM = (
    "Eres un profesor de clínica veterinaria. Te doy la CONSULTA de un veterinario y los PASAJES de "
    "literatura que un buscador recuperó del corpus.\n"
    "NO evalúes ninguna respuesta. Decidí SÓLO esto: con esos pasajes, ¿un veterinario podría "
    "fundamentar una respuesta útil al caso concreto?\n"
    "Sé estricto: que hablen de la misma especie, del mismo aparato, o que mencionen un signo de "
    "forma incidental NO alcanza. Tiene que tratar el problema concreto de la consulta, aunque sea "
    "bajo otro nombre o en otro idioma — lo que importa es el CONTENIDO, no la etiqueta.\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"alcanza": true|false, "puntaje": 0-10, "tema_de_los_pasajes": "de qué tratan realmente, una '
    'frase", "motivo": "una frase"}'
)

ARBITRO: object = None


def evalua(caso: dict) -> dict:
    _q, chunks, passed = build_and_retrieve(caso["query"], caso.get("especie"))
    lit = chunks[:CHAT_LIT_LIMIT]
    # El juez de producción, para poder comparar su criterio con el del árbitro.
    v = judge_evidence(caso["query"], lit if passed else [])
    pasajes = "\n\n".join(f"[{i}] {(c.content or '')[:900]}" for i, c in enumerate(lit[:6], 1))
    raw = ARBITRO.complete(
        ARBITRO_SYSTEM,
        f"CONSULTA:\n{caso['query'][:2000]}\n\nPASAJES RECUPERADOS:\n{pasajes}",
        max_tokens=400)
    arb = _parse_json(raw) or {}
    return {
        "id": caso["id"], "mesh_target": caso.get("mesh_target"), "especie": caso.get("especie"),
        "arbitro_alcanza": arb.get("alcanza"),
        "arbitro_puntaje": arb.get("puntaje"),
        "tema_real": str(arb.get("tema_de_los_pasajes") or "")[:200],
        "arbitro_motivo": str(arb.get("motivo") or "")[:200],
        "juez_prod_banda": v.band, "juez_prod_puntaje": v.score,
        "passed_umbral": passed,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=0, help="0 = todos")
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--juez-modelo", default="deepseek-v4-pro")
    ap.add_argument("--juez-proveedor", default="openai", choices=("anthropic", "openai"))
    args = ap.parse_args()

    global ARBITRO
    ARBITRO = _judge_client(args.juez_modelo, args.juez_proveedor)

    ruta = os.path.join(BASE, "tests", "golden", "ampliado_negativos.json")
    casos = json.load(open(ruta, encoding="utf-8"))
    if args.n:
        casos = casos[:args.n]

    def log(m):
        print(f"[{time.strftime('%H:%M:%S')}] {m}", flush=True)

    log(f"validando {len(casos)} negativos con árbitro={args.juez_modelo}")

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(evalua, c): c for c in casos}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                filas.append(fut.result())
            except Exception as e:  # noqa: BLE001
                log(f"  {futs[fut]['id']} falló: {e}")
            if i % 10 == 0:
                log(f"  {i}/{len(casos)}")

    validos = [f for f in filas if f["arbitro_alcanza"] is False]
    falsos = [f for f in filas if f["arbitro_alcanza"] is True]
    indef = [f for f in filas if f["arbitro_alcanza"] not in (True, False)]

    print("\n" + "=" * 92)
    print("VALIDACIÓN DEL BANCO DE NEGATIVOS")
    print("=" * 92)
    print(f"  evaluados                        : {len(filas)}")
    print(f"  ✅ negativos REALES (no alcanza) : {len(validos)}")
    print(f"  ❌ falsos negativos (sí alcanza) : {len(falsos)}")
    if indef:
        print(f"  ⚠️  sin veredicto del árbitro     : {len(indef)}")
    if validos:
        print(f"  puntaje del árbitro en los reales (mediana): "
              f"{statistics.median([f['arbitro_puntaje'] or 0 for f in validos]):.1f}")

    if falsos:
        print("\n  FALSOS NEGATIVOS — el corpus sí cubre el tema (sacar del banco):")
        for f in sorted(falsos, key=lambda x: -(x["arbitro_puntaje"] or 0)):
            print(f"    {f['id']:44} árbitro={f['arbitro_puntaje']}  -> {f['tema_real'][:90]}")

    # Con el banco limpio ya se puede medir el juez de producción sin sesgo.
    if validos:
        bandas = {}
        for f in validos:
            bandas[f["juez_prod_banda"]] = bandas.get(f["juez_prod_banda"], 0) + 1
        abst = bandas.get("none", 0)
        print("\n" + "=" * 92)
        print("EL JUEZ DE PRODUCCIÓN, MEDIDO SÓLO CONTRA LOS NEGATIVOS REALES")
        print("=" * 92)
        print(f"  bandas: {bandas}")
        print(f"  se abstiene correctamente        : {abst}/{len(validos)} "
              f"({abst / len(validos):.0%})")
        print(f"  declara evidencia limitada       : {bandas.get('limited', 0)}/{len(validos)}")
        print(f"  responde con confianza (falla)   : {bandas.get('sufficient', 0)}/{len(validos)}")

    # Banco depurado, con la misma forma que el original para que los scripts lo consuman igual.
    orig = {c["id"]: c for c in json.load(open(ruta, encoding="utf-8"))}
    depurado = [orig[f["id"]] for f in validos if f["id"] in orig]
    for c, f in zip(depurado, validos):
        c["arbitro_puntaje"] = f["arbitro_puntaje"]
        c["validado"] = "2026-07-29"
    out_banco = os.path.join(BASE, "tests", "golden", "ampliado_negativos_validado.json")
    json.dump(depurado, open(out_banco, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    out_informe = os.path.join(SCRATCH, "negativos_validacion.json")
    json.dump(filas, open(out_informe, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  banco depurado ({len(depurado)} casos) -> {out_banco}")
    print(f"  informe completo -> {out_informe}")


if __name__ == "__main__":
    main()
