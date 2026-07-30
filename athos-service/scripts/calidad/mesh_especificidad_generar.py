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

# ⚠️ SEGUNDA REGLA: LA PROFUNDIDAD. La regla C23 sola deja pasar los PARAGUAS — descriptores altos
# del árbol que nombran una familia, no un diagnóstico: `Infections` (C01), `Neoplasms` (C04),
# `Bacterial Infections` (C01.252), `Bone Diseases` (C05.116). Decir "infección bacteriana" no es
# diagnosticar nada, y sin embargo bastaba para que el A->B se saltara la distilación.
#
# El daño era medible. El caso `lyme-disease` del banco resolvía fiebre + cojera + letargo + anorexia
# + "Bacterial Infections", el sistema lo tomaba por diagnóstico concreto, **no distilaba**, y el
# retrieval nunca recibía `Lyme Disease`. El descriptor correcto aparecía recién en el puesto 36 del
# vector y el reranker lo descartaba — el síntoma que se venía atribuyendo al reranker.
#
# Un descriptor con profundidad >= 3 nombra algo concreto (Babesiosis 3, Dermatitis 3, Lyme 4,
# Pyometra 5); con <= 2 es una familia.
MIN_PROFUNDIDAD = 3

# La rama **C22 (Animal Diseases)** se IGNORA al medir la profundidad, y esto es lo que no es obvio:
# es un árbol espejo de las enfermedades animales, superficial por construcción. `Anaplasmosis` está
# en `C01.150.252.400.054.500` (profundidad 6) pero también en `C22.085` (2): tomar el mínimo sobre
# todas las ramas la habría descartado como si fuera un paraguas. Se mide sobre las ramas
# principales, y sólo se usa C22 cuando es la única — que es el caso de los cubos por especie
# (`Dog Diseases` C22.268) y de `Lameness, Animal` (C22.510), que así quedan fuera solos, sin lista
# a mano. `Hip Dysplasia, Canine` (C22.268.485) sí se conserva.
RAMA_ESPEJO_ANIMAL = "C22"


# Paraguas de infección que la profundidad no alcanza a filtrar: están a 3 pero nombran una familia
# entera, no un diagnóstico. Un veterinario no cierra una consulta diciendo "infección bacteriana".
# Es la lista corta y explícita que hace falta porque el árbol no los distingue de un diagnóstico.
FAMILIAS_DE_INFECCION = {
    "Bacterial Infections", "Virus Diseases", "Mycoses", "Parasitic Diseases",
    "Communicable Diseases", "Coinfection", "Community-Acquired Infections",
    "Parasitic Diseases, Animal", "Protozoan Infections", "Protozoan Infections, Animal",
}


def _profundidad(rs: list[str]) -> int:
    """Profundidad del descriptor en el árbol de enfermedades. 0 si no está en la rama C.

    Se toma el **máximo** entre las ramas, no el mínimo, y la diferencia no es teórica:
    `Diabetes Mellitus` está en `C18.452.394.750` (profundidad 4) y también en `C19.246` (2). Con el
    mínimo quedaba clasificada como paraguas — y es el ejemplo que motiva este módulo entero ("toma
    mucha agua, orina mucho, bajó de peso"). Un descriptor es concreto si aparece profundo en ALGUNA
    rama; que además cuelgue de una categoría alta no lo hace genérico.
    """
    ramas_c = [r for r in rs if r.startswith("C")]
    principales = [r for r in ramas_c if not r.startswith(RAMA_ESPEJO_ANIMAL)]
    usar = principales or ramas_c
    return max((r.count(".") + 1) for r in usar) if usar else 0


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
                          if d not in signos and d not in FAMILIAS_DE_INFECCION
                          and _profundidad(rs) >= MIN_PROFUNDIDAD)

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
