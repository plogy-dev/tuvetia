# -*- coding: utf-8 -*-
"""Genera `app/glossary/data/mesh_diagnostic.json`: qué descriptores MeSH nombran una CONDICIÓN
concreta y cuáles son signos inespecíficos.

Regla (validada contra 36 etiquetas a mano, 34 aciertos): en MeSH la rama **C23** es "Pathological
Conditions, Signs and Symptoms". Un descriptor con ALGUNA rama C23 es un signo (vómito, fiebre,
letargo, tos, prurito, adelgazamiento); uno dentro de C sin ninguna rama C23 es una condición
concreta (Babesiosis, Rabies, Pyometra, Lymphoma). Fuera de C quedan fármacos (D), procedimientos
(E), organismos (B), etc.: útiles como contexto pero no son un diagnóstico.

Para qué sirve: el A->B decidía si distilar con el LLM CONTANDO conceptos (`MIN_CONFIDENT_CONCEPTS`),
así que una consulta que resolvía tres signos genéricos ("toma mucha agua, orina mucho, bajó de
peso") se saltaba la inferencia que habría nombrado la enfermedad. Contar no es lo mismo que
entender: un solo "Babesiosis" vale más que tres signos.

Uso:  python scripts/calidad/mesh_especificidad_generar.py
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(BASE)

TSV = "scripts/calidad/corpus_mesh_clasificado.tsv"
DESTINO = "app/glossary/data/mesh_diagnostic.json"


def main() -> None:
    ramas: dict[str, list[str]] = {}
    for linea in open(TSV, encoding="utf-8"):
        p = linea.rstrip("\n").split("\t")
        if len(p) >= 4:
            ramas[p[0]] = [x.strip() for x in p[3].split(",") if x.strip()]
        elif len(p) == 3:
            ramas[p[0]] = []

    signos = {d for d, rs in ramas.items() if any(r.startswith("C23") for r in rs)}
    diagnosticos = sorted(d for d, rs in ramas.items()
                          if d not in signos and any(r.startswith("C") for r in rs))

    # Guarda de regresión: si un cambio del TSV rompe estas etiquetas, algo se corrompió.
    debe_ser_signo = ["Vomiting", "Diarrhea", "Fever", "Lethargy", "Cough", "Anorexia", "Pruritus",
                      "Weight Loss", "Hemorrhage", "Abdominal Pain", "Seizures", "Polydipsia"]
    debe_ser_diag = ["Babesiosis", "Distemper", "Ehrlichiosis", "Giardiasis", "Pyometra", "Rabies",
                     "Leishmaniasis", "Dirofilariasis", "Parvoviridae Infections", "Lymphoma",
                     "Hyperthyroidism", "Diabetes Mellitus", "Sporotrichosis", "Coccidiosis"]
    mal = ([d for d in debe_ser_signo if d in ramas and d not in signos]
           + [d for d in debe_ser_diag if d in ramas and d in signos])
    if mal:
        print(f"ABORTADO: la clasificacion contradice las etiquetas de control: {mal}")
        sys.exit(1)

    os.makedirs(os.path.dirname(DESTINO), exist_ok=True)
    json.dump({"_doc": "Descriptores MeSH que nombran una condicion concreta (rama C sin C23). "
                       "Generado por scripts/calidad/mesh_especificidad_generar.py — no editar a mano.",
               "diagnostic": diagnosticos},
              open(DESTINO, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(f"{len(ramas)} descriptores -> {len(diagnosticos)} diagnosticos, {len(signos)} signos")
    print(f"escrito: {DESTINO}")


if __name__ == "__main__":
    main()
