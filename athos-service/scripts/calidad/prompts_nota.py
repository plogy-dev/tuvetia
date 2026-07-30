# -*- coding: utf-8 -*-
"""Variantes del prompt de la NOTA SOAP del Fantasma, para el A/B pareado (`phantom_ab.py`).

`actual` se IMPORTA de `app.generation.generate` — una copia mentiría en cuanto alguien toque el
código. Las variantes son texto plano acá.
"""
from app.generation.generate import CLINICAL_SYSTEM_PROMPT

# El bloque que se INSERTA antes de las instrucciones de formato JSON. El prompt de producción no
# define en ningún momento qué significan S, O, A y P — y eso explica los dos defectos medidos el
# 2026-07-29 sobre 16 notas:
#   1. Cruce de atribución: en `pyometra` la fiebre la midió el veterinario y la nota la puso en S
#      como algo que "refirió la propietaria". En una historia clínica S y O no son secciones
#      decorativas: son la PROCEDENCIA del dato. Si se cruzan, un lector posterior no sabe qué se
#      verificó y qué es relato.
#   2. Ascenso de terminología: "ojos un poco saltones" salió como 'exoftalmos' y "se sienta raro"
#      como 'bunny hopping gait'. Son signos con nombre propio: escritos en O se leen como que
#      alguien los constató, cuando nadie los examinó.
SOAP_ATRIBUCION = (
    "CÓMO SE REPARTE LA INFORMACIÓN ENTRE S, O, A y P. En una historia clínica estas secciones "
    "indican la PROCEDENCIA del dato, no son un formato decorativo — quien lea el expediente después "
    "necesita saber qué se verificó y qué es relato:\n"
    "- subjective: SOLO lo que el dueño o cuidador relata (motivo, evolución, lo que notó en casa). "
    "Escribilo en los términos en que lo dijo.\n"
    "- objective: SOLO lo que el veterinario constató en ESTA consulta — lo que palpó, auscultó, "
    "midió o vio, y los resultados de estudios ya hechos. Si un dato no se tomó (peso, temperatura, "
    "frecuencias), decí que no se registra; no lo dejes implícito ni lo completes.\n"
    "- NUNCA muevas un dato de una sección a la otra. Si la fiebre la midió el veterinario, va en O y "
    "no en S; si el dueño dijo que el animal 'estaba caliente', va en S y no en O.\n"
    "- NO ASCIENDAS el lenguaje del relato a un signo con nombre propio. Si el dueño dijo 'ojos "
    "saltones' o 'camina raro', eso es lo que va en S. El término técnico ('exoftalmos', 'marcha de "
    "conejo') solo puede aparecer en A, como interpretación tuya y en lenguaje de posibilidad — "
    "escrito en S o en O se lee como que alguien lo examinó.\n"
    "- assessment: tu interpretación diagnóstica, con diferenciales y en lenguaje de posibilidad. Es "
    "el único lugar donde razonás más allá de lo dicho.\n"
    "- plan: qué se va a hacer, accionable y priorizado.\n\n"
)


def _insertar_antes_del_json(base: str, bloque: str) -> str:
    marca = "Devuelve EXCLUSIVAMENTE un objeto JSON válido"
    i = base.index(marca)
    return base[:i] + bloque + base[i:]


# v2: `soap_atribucion` ganó donde importa (firmaría 8/16 -> 10/16, notas que inventan 10 -> 5,
# estructura +0.5, seguridad +0.6) pero abrió un defecto propio: pedirle que "diga que no se registra"
# lo empujó a declarar ausencias sin verificarlas. En `rickettsia-infections` escribió que no se
# evaluaron los ganglios cuando la transcripción dice explícitamente que estaban inflamados —
# fidelidad 10 -> 2. Afirmar una ausencia falsa es tan grave como inventar un hallazgo: las dos cosas
# le mienten a quien lea el expediente. v2 mantiene la atribución y acota SOLO esa cláusula.
SOAP_ATRIBUCION_V2 = SOAP_ATRIBUCION.replace(
    "Si un dato no se tomó (peso, temperatura, "
    "frecuencias), decí que no se registra; no lo dejes implícito ni lo completes.\n",
    "Si un dato no se tomó (peso, temperatura, frecuencias), no lo completes ni lo estimes. Podés "
    "dejar constancia de que falta, pero SOLO de lo que verificaste que no aparece en la "
    "transcripción: escribir 'no se evaluaron los ganglios' cuando sí se evaluaron es tan grave como "
    "inventar un hallazgo. Ante la duda, no menciones la ausencia.\n",
)
assert SOAP_ATRIBUCION_V2 != SOAP_ATRIBUCION, "el replace de la cláusula de ausencias no aplicó"

VARIANTES = {
    "actual": CLINICAL_SYSTEM_PROMPT,
    "soap_atribucion": _insertar_antes_del_json(CLINICAL_SYSTEM_PROMPT, SOAP_ATRIBUCION),
    "soap_atribucion_v2": _insertar_antes_del_json(CLINICAL_SYSTEM_PROMPT, SOAP_ATRIBUCION_V2),
}
