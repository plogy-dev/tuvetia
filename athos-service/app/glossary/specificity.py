"""¿Lo que resolvió el glosario nombra una CONDICIÓN concreta, o son sólo signos?

El A->B decidía si llamar al LLM liviano CONTANDO conceptos (`MIN_CONFIDENT_CONCEPTS=3`). Contar no
es entender: "toma mucha agua, orina mucho y bajó de peso" resuelve tres signos genéricos
(Polydipsia, Polyuria, Weight Loss), se pasaba de largo el umbral y el retrieval nunca recibía
`Diabetes Mellitus` ni `Renal Insufficiency, Chronic` — justo la inferencia que un veterinario
experimentado hace de oído. A la inversa, un único `Babesiosis` es más específico que tres signos y
no necesita que ninguna IA lo interprete.

La clasificación sale del árbol MeSH (`app/glossary/data/mesh_diagnostic.json`, generado por
`scripts/calidad/mesh_especificidad_generar.py`): la rama **C23** es "Pathological Conditions, Signs
and Symptoms", así que un descriptor con alguna rama C23 es un signo y uno dentro de C sin ninguna
C23 es una condición. Fármacos, procedimientos y organismos quedan fuera: acompañan al cuadro pero
no son un diagnóstico.
"""
import json
import os
from functools import lru_cache

_DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "mesh_diagnostic.json")


@lru_cache(maxsize=1)
def diagnostic_descriptors() -> frozenset[str]:
    """Descriptores MeSH que nombran una condición concreta. Si el archivo faltara, devuelve vacío:
    el A->B degrada al comportamiento anterior (contar conceptos), nunca se rompe."""
    try:
        with open(_DATA, encoding="utf-8") as f:
            return frozenset(json.load(f)["diagnostic"])
    except Exception:  # noqa: BLE001 — sin el dato se degrada, no se cae
        return frozenset()


def names_a_condition(concepts: list[str]) -> bool:
    """True si ALGUNO de los conceptos es una condición concreta (no un signo inespecífico)."""
    diag = diagnostic_descriptors()
    return any(c in diag for c in concepts)
