# -*- coding: utf-8 -*-
"""Precisión del glosario: qué sinónimos aprobados inyectan una enfermedad que no viene al caso.

El glosario falla de dos maneras. La de RECALL (falta el término) se ataca con
`glosario_criticos.py`. Ésta es la de PRECISIÓN: si `"esta decaido"` está aprobado como sinónimo de
`Kidney Diseases`, entonces CUALQUIER consulta que mencione decaimiento —un tumor, un parásito, un
problema dental— arrastra enfermedad renal al retrieval, y encima suma para el umbral que decide si
hace falta que el LLM interprete el cuadro.

No se juzga a ojo: se MIDE sobre las 188 transcripciones reales del banco (146 positivas + 42
negativas). Por cada sinónimo aprobado que apunta a una condición concreta:

  dispara_en  : en cuántas transcripciones aparece la frase
  al_blanco   : en cuántas de esas el descriptor al que apunta ERA el tema del caso
  ruido       : dispara_en - al_blanco

**Leé esto antes de actuar sobre la salida.** Disparar fuera del blanco NO implica que el sinónimo
esté mal. La medición del 2026-07-28 lo dejó claro: los que más "ruido" acumulan son
`"parasitos" -> Parasitic Diseases, Animal` (16 casos, 0 al blanco) y `"cojea" -> Lameness, Animal`
(8 y 0), y los dos son **conceptos padre correctos**: en un caso de toxocariasis, traer literatura
de enfermedad parasitaria es acertar, no ensuciar. La cifra ordena candidatos para que los revise un
veterinario; no decide sola.

Lo que sí es un error demostrable es una frase de signo genérico apuntando a una enfermedad
CONCRETA que el banco nunca confirma. Así se detectaron los dos únicos casos reales, ya corregidos
en `glosario_criticos.REMAPEOS` (se remapean al descriptor de signo, no se borran):
  "esta decaido"  -> Kidney Diseases  (5 disparos, 0 renales)   => Lethargy
  "se cansa mucho" -> Heart Failure   (4 disparos, 0 cardíacos) => Lethargy

Uso: python scripts/calidad/glosario_precision.py
"""
import argparse
import json
import os
import sys

SCRATCH = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(os.path.dirname(SCRATCH))
sys.path.insert(0, BASE)
os.chdir(BASE)

from app.db import fetch_all_corpus                       # noqa: E402
from app.glossary.resolve import _normalize               # noqa: E402
from app.glossary.specificity import diagnostic_descriptors  # noqa: E402


def _casos() -> list[dict]:
    g = os.path.join(BASE, "tests", "golden")
    casos = json.load(open(os.path.join(g, "ampliado.json"), encoding="utf-8"))
    negativos = json.load(open(os.path.join(g, "ampliado_negativos.json"), encoding="utf-8"))
    return casos + negativos


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--top", type=int, default=30, help="cuantos candidatos listar para revision")
    args = ap.parse_args()

    diag = diagnostic_descriptors()
    sinonimos = fetch_all_corpus(
        "select s.id, s.text, t.canonical_en from public.glossary_synonym s "
        "join public.glossary_term t on t.id = s.term_id "
        "where s.review_status = 'approved' and s.lang = 'es'")
    casos = _casos()
    textos = [(c.get("mesh_target"), f" {_normalize(c['query'])} ") for c in casos]
    print(f"sinonimos ES aprobados: {len(sinonimos)} | transcripciones del banco: {len(casos)}\n")

    filas = []
    for s in sinonimos:
        if s["canonical_en"] not in diag:      # sólo los que apuntan a una condición concreta
            continue
        aguja = f" {_normalize(s['text'])} "
        if not aguja.strip():
            continue
        dispara = [t for t in textos if aguja in t[1]]
        if not dispara:
            continue
        al_blanco = sum(1 for objetivo, _ in dispara if objetivo == s["canonical_en"])
        filas.append({"id": s["id"], "text": s["text"], "en": s["canonical_en"],
                      "dispara": len(dispara), "al_blanco": al_blanco,
                      "ruido": len(dispara) - al_blanco})

    filas.sort(key=lambda f: -f["ruido"])
    print(f"{'sinonimo':<40} {'-> descriptor':<34} {'disp':>5} {'blanco':>7} {'fuera':>6}")
    print("-" * 96)
    for f in filas[:args.top]:
        print(f"  {f['text'][:38]:<38} {f['en'][:32]:<34} {f['dispara']:>5} "
              f"{f['al_blanco']:>7} {f['ruido']:>6}")

    print(f"\n{len(filas)} sinonimos disparan al menos una vez en el banco.")
    print("PARA REVISION VETERINARIA, no accion automatica: 'fuera' alto puede ser un concepto")
    print("PADRE correcto (parasitos -> Parasitic Diseases en un caso de toxocariasis acierta).")
    print("El error real es una frase de SIGNO generico que afirma una enfermedad CONCRETA;")
    print("los dos detectados ya estan corregidos en glosario_criticos.REMAPEOS.")


if __name__ == "__main__":
    main()
