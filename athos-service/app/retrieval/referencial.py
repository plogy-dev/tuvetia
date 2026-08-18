"""Preguntas REFERENCIALES: las que señalan al paciente en vez de plantear un cuadro.

EL CASO QUE LO ORIGINA, con su traza. El 17-ago un veterinario preguntó, con Manchita en contexto:

    "hola que piensas  sobre la ccondiccion de manncchita"

y Athos se abstuvo. La fila de `rag_retrieval_log` explica por qué sin ambigüedad:

    concepts   = ["cat", "feline", "clinical condition"]   <- ni un solo descriptor diagnóstico
    top_score  = 0.90                                       (las consultas buenas dan 1,6-1,8)
    n_chunks   = 15,  passed_threshold = true               (saturado, como está documentado)
    rag_answer_log: NINGUNA FILA                            <- el juez abstuvo, no se generó nada

**El juez tenía razón.** Con esa consulta ninguna literatura la fundamenta: la condición no está en
las palabras, está en la ficha. Pedirle al juez que sea más indulgente sería romper la regla 1
("cita o se calla") para tapar un problema que no es suyo.

El problema es de la CONSULTA. Y el dato faltaba a un JOIN de distancia: 55 minutos antes, el propio
sistema le había escrito a Manchita esta evaluación:

    "Cuadro clínico compatible con vómitos crónicos (>1 semana) en gato, con posibles diagnósticos
     diferenciales que incluyen cuerpo extraño gastrointestinal (antecedente de cuerda), enfermedad
     inflamatoria intestinal, enfermedad renal crónica, o trastornos metabólicos."

Eso SÍ es una consulta de retrieval. Lo que hace este módulo es usarla.

CUÁNDO SE DISPARA — y es la decisión de diseño que importa. Sólo cuando hay paciente en contexto Y
la consulta **no nombra ninguna condición concreta**, que es el mismo predicado con el que el A->B
decide si distilar (`glossary/specificity.names_a_condition`, rama C23 del árbol MeSH). En el camino
bueno —el vet que escribe "manejo de luxación patelar en perros"— no cambia absolutamente nada: ni
una query más, ni un token más, ni un cambio en lo que ve el juez.

Eso es deliberado. El juez está calibrado sobre un banco de 187 casos y su severidad es la regla de
seguridad del producto; enriquecer la consulta SIEMPRE movería esa calibración en todos los casos, y
no hay forma de re-medirla acá. Así, la única rama que cambia es la que hoy termina en una
abstención inútil.

LO QUE ESTO **NO** ES. El resumen clínico entra a la CONSULTA, nunca a la evidencia. No se cita, no
cuenta como respaldo y no toca el corpus: sirve para saber QUÉ buscar. Las citas siguen saliendo
sólo de `corpus_chunks`, igual que antes. Es la misma frontera que ya respeta la historia previa en
`_chat_prompt` ("contexto, NO es literatura").
"""
from app.glossary.specificity import names_a_condition

#: Recorte del resumen clínico. La evaluación de una nota SOAP entra entera en mucho menos que esto;
#: el tope existe para que una nota anómala no desplace a la pregunta del vet dentro de la consulta.
MAX_RESUMEN_CHARS = 700


def es_referencial(concepts: list[str]) -> bool:
    """¿La consulta señala al paciente en vez de nombrar un cuadro?

    Se apoya en el mismo predicado que el A->B: si ningún concepto es un descriptor diagnóstico, lo
    que se resolvió son signos genéricos o —como en el caso de Manchita— nada en absoluto.

    Sin el archivo de descriptores MeSH, `names_a_condition` devuelve False para todo y esto daría
    True siempre. Es el lado seguro: enriquecer de más cuesta una consulta mejor formada; enriquecer
    de menos devuelve la abstención.
    """
    return not names_a_condition(concepts)


def consulta_enriquecida(question: str, resumen: str | None) -> str:
    """Compone el texto que van a ver el retrieval y el juez.

    La pregunta del vet va PRIMERO y completa: es lo que se está respondiendo, y tanto el vector del
    Tier 2 como el juez la leen como el asunto principal. El resumen va detrás, rotulado, como el
    contexto que la pregunta da por sabido.

    Sin resumen devuelve la pregunta tal cual — no hay nada que agregar y no se inventa nada.
    """
    limpio = (resumen or "").strip()
    if not limpio:
        return question
    return f"{question.strip()}\n\nCuadro clínico registrado de este paciente: {limpio[:MAX_RESUMEN_CHARS]}"
