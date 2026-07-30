# -*- coding: utf-8 -*-
"""Juez PAREADO POR COMPARACIÓN: ¿cuál de las dos notas es mejor? Reutiliza notas ya generadas.

POR QUÉ EXISTE, y es la lección más cara de esta serie de mediciones: el juez que puntúa en abstracto
("fidelidad de 0 a 10", "¿la firmarías?") es demasiado ruidoso para decidir. Sobre el MISMO prompt de
producción y el MISMO banco, cinco corridas dieron **firmaría 8/16, 9/16, 17/40, 20/40, 24/40 y
27/40**, e `inventan_so` 12/40 y 15/40. Con un ruido de ±7 sobre 40, ningún efecto menor a ~20 puntos
porcentuales es detectable — y todos los que se probaron son menores. Por eso cuatro variantes
seguidas "empataron": no es que no hicieran nada, es que el instrumento no podía verlas.

La comparación directa quita casi todo ese ruido. El juez no tiene que calibrar una escala absoluta —
sólo mirar dos notas del MISMO caso y decir cuál inventa menos. Es el arreglo estándar para esto.

Dos cuidados que lo hacen válido:
  - **Orden alternado** (par → A primero, impar → B primero) y las notas se presentan como «1» y «2»
    sin decir cuál es cuál: sin esto el juez favorece sistemáticamente a la primera.
  - **Se cuentan los empates aparte**, no se reparten: forzar una preferencia inventa señal.

No genera nada: toma un `phantom_ab_*.json` que ya tiene las dos notas de cada caso.

Uso:
  python scripts/calidad/phantom_duelo.py --archivo phantom_ab_actual_vs_reparado.json
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from scripts.calidad.respuestas_eval import _judge_client, _muestra, _parse_json  # noqa: E402

JUDGE = None

DUELO_SYSTEM = (
    "Eres un auditor de historias clínicas veterinarias. Te doy la TRANSCRIPCIÓN de una consulta y "
    "DOS versiones de la nota SOAP que se redactó a partir de ella. El veterinario va a FIRMAR una de "
    "las dos y va a quedar en el expediente del paciente.\n\n"
    "Compará las dos y decidí cuál es mejor. Lo que más pesa, en este orden:\n"
    "1. FIDELIDAD: ¿alguna afirma en S u O un hecho que la consulta no contiene? Inventar un hallazgo "
    "de examen que nadie hizo, cambiar el sitio o el grado de uno que sí existe ('petequias en piel' "
    "escrito como 'petequias gingivales'), o atribuir al dueño lo que constató el veterinario. Es lo "
    "más grave: una historia clínica falsa tiene consecuencias legales.\n"
    "2. ESTRUCTURA: ¿S es lo que relata el dueño y O lo que constató el veterinario?\n"
    "3. COMPLETITUD y UTILIDAD: ¿deja afuera algo relevante? ¿el plan sirve?\n\n"
    "NO son defectos: las citas [1], [3] son legítimas y las verifica el sistema aparte; interpretar "
    "y proponer estudios o fármacos es el trabajo del análisis y el plan; documentar que falta un dato "
    "es correcto.\n\n"
    "Si de verdad son equivalentes, decí 'empate' — no fuerces una preferencia.\n\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"mejor": "1"|"2"|"empate", "mas_fiel": "1"|"2"|"empate", "por_que": "una frase"}'
)


def _nota(soap: dict) -> str:
    return (f"S (subjetivo): {soap.get('subjective', '')}\n"
            f"O (objetivo): {soap.get('objective', '')}\n"
            f"A (análisis): {soap.get('assessment', '')}\n"
            f"P (plan): {soap.get('plan', '')}")


def duelo(caso: dict, transcript: str, invertir: bool) -> dict | None:
    a, b = (caso.get("a") or {}).get("soap"), (caso.get("b") or {}).get("soap")
    if not a or not b:
        return None
    # `invertir` alterna quién va primero. El juez ve «1» y «2» y no sabe cuál rama es cada una.
    primera, segunda = (b, a) if invertir else (a, b)
    user = (f"TRANSCRIPCIÓN DE LA CONSULTA:\n{transcript.strip()[:3500]}\n\n"
            f"NOTA 1:\n{_nota(primera)}\n\n"
            f"NOTA 2:\n{_nota(segunda)}")
    raw = JUDGE.complete(DUELO_SYSTEM, user, max_tokens=400)
    v = _parse_json(raw)
    if not v:
        return None

    def a_rama(x: str) -> str:
        """Traduce «1»/«2» a la rama real, deshaciendo la inversión."""
        if x not in ("1", "2"):
            return "empate"
        primera_es = "b" if invertir else "a"
        segunda_es = "a" if invertir else "b"
        return primera_es if x == "1" else segunda_es

    return {"id": caso["id"], "invertido": invertir,
            "mejor": a_rama(str(v.get("mejor", ""))),
            "mas_fiel": a_rama(str(v.get("mas_fiel", ""))),
            "por_que": str(v.get("por_que", ""))[:200]}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--archivo", required=True)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--juez-modelo", default="deepseek-v4-pro")
    ap.add_argument("--juez-proveedor", default="openai", choices=("anthropic", "openai"))
    args = ap.parse_args()

    global JUDGE
    JUDGE = _judge_client(args.juez_modelo, args.juez_proveedor)

    d = json.load(open(os.path.join(SCRATCH, args.archivo), encoding="utf-8"))
    nombre_a = (d.get("a") or {}).get("nombre", "a")
    nombre_b = (d.get("b") or {}).get("nombre", "b")
    banco = {c["id"]: c for c in _muestra(
        json.load(open(os.path.join(BASE, "tests", "golden", "ampliado.json"), encoding="utf-8")),
        10_000)}
    casos = [c for c in d["casos"] if c["id"] in banco]
    print(f"[{time.strftime('%H:%M:%S')}] {len(casos)} duelos · {nombre_a} vs {nombre_b} · "
          f"juez={JUDGE.model} · orden alternado", flush=True)

    filas = []
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(duelo, c, banco[c["id"]]["query"], i % 2 == 1): c
                for i, c in enumerate(casos)}
        for i, fut in enumerate(as_completed(futs), 1):
            try:
                r = fut.result()
                if r:
                    filas.append(r)
            except Exception as e:  # noqa: BLE001
                print(f"  {futs[fut]['id']} falló: {e}", flush=True)
            if i % 10 == 0:
                print(f"  {i}/{len(casos)}", flush=True)

    print("\n" + "=" * 78)
    print(f"DUELO PAREADO   ({len(filas)} casos)   {nombre_a}  vs  {nombre_b}")
    print("=" * 78)
    for campo, titulo in (("mas_fiel", "MÁS FIEL A LA CONSULTA (lo que más importa)"),
                          ("mejor", "MEJOR EN GENERAL")):
        ga = sum(1 for f in filas if f[campo] == "a")
        gb = sum(1 for f in filas if f[campo] == "b")
        emp = len(filas) - ga - gb
        decisivos = ga + gb
        print(f"\n  {titulo}")
        print(f"    {nombre_a:<22} gana {ga:>3}")
        print(f"    {nombre_b:<22} gana {gb:>3}")
        print(f"    {'empate':<22}      {emp:>3}")
        if decisivos:
            pct = 100 * gb / decisivos
            # Regla de decisión fijada ANTES de mirar: con ~40 casos y sólo los decisivos, una
            # ventaja menor a 65/35 no se distingue de una moneda. Se dice explícito para no
            # racionalizar un 55/45 como victoria después de ver el número.
            if pct >= 65:
                veredicto = f"GANA {nombre_b}"
            elif pct <= 35:
                veredicto = f"GANA {nombre_a}"
            else:
                veredicto = "SIN DIFERENCIA (dentro de lo que una moneda produciría)"
            print(f"    -> {nombre_b} se lleva el {pct:.0f}% de los {decisivos} decisivos: {veredicto}")

    # Chequeo de sesgo de posición: si el orden importara, el instrumento estaría roto.
    pares, impares = [f for f in filas if not f["invertido"]], [f for f in filas if f["invertido"]]
    for etiqueta, grupo in (("A primero", pares), ("B primero", impares)):
        if grupo:
            gb = sum(1 for f in grupo if f["mas_fiel"] == "b")
            dec = sum(1 for f in grupo if f["mas_fiel"] in ("a", "b"))
            print(f"  [sesgo de orden] con {etiqueta:<10}: {nombre_b} gana {gb}/{dec} decisivos")

    destino = os.path.join(SCRATCH, f"duelo_{nombre_a}_vs_{nombre_b}.json")
    json.dump(filas, open(destino, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(f"\n  -> {destino}")


if __name__ == "__main__":
    main()
