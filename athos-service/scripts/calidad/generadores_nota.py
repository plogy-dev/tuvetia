# -*- coding: utf-8 -*-
"""Estrategias de GENERACIÓN de la nota, para el A/B pareado (`phantom_ab.py`).

Distinto de `prompts_nota.py`: ahí se cambia el texto del prompt y acá se cambia **cómo se genera**.
Se probó lo primero y no alcanzó — dos variantes de prompt dieron fidelidad +0,0 sobre 40 casos —, así
que la hipótesis que queda por medir es estructural, no de redacción.

LA HIPÓTESIS: **la literatura en el contexto es lo que empuja al modelo a decorar S y O.**

Hoy la nota sale de UNA llamada que recibe la transcripción y 15 pasajes de literatura veterinaria a
la vez, y se le pide que escriba las cuatro secciones. Los inventos medidos tienen todos la misma
pinta: hallazgos que suenan a libro ("reflejo pupilar normal", "petequias gingivales", "ictericia en
escleras"). Son justamente los signos que aparecen descritos en los pasajes del cuadro que el modelo
está reconociendo. La sospecha es que no está mintiendo: está completando el cuadro clínico con lo que
la literatura dice que debería haber, y lo escribe en O como si se hubiera observado.

Si eso es cierto, **sacarle la literatura de la vista mientras escribe S y O** debería bajar el
invento sin costar nada en el análisis. La `split` hace eso: dos llamadas, y la primera no ve un solo
pasaje.

Costo: una llamada LLM más por nota. El Fantasma es asíncrono —se dispara al cerrar la consulta y
nadie espera el primer token—, así que el costo es en tokens, no en espera del veterinario.

⚠️ RESULTADO: **NO ADOPTADA.** Se conserva porque la idea es buena y alguien va a volver a tenerla.

    n=8:   fidelidad +0,9   inventan 3 -> 1     (parecía un acierto claro)
    n=40:  fidelidad +0,2   inventan 21 -> 20   firmaría 24 -> 21 (PEOR)
           y caso a caso: 12 mejoran, 13 empeoran, 15 empatan

Gana en seguridad (+0,8) y baja a la mitad lo que señala el auditor de producción (4 notas -> 2), que
es una señal independiente y apunta en la dirección de la hipótesis. Pero firmaría empeora y la
fidelidad no se mueve: **está dentro del ruido**, igual que las dos variantes de prompt. Tercer
intento, tercer empate.

Y ACÁ ESTÁ LA RAZÓN POR LA QUE LOS TRES EMPATARON, que importa más que las tres variantes:
**el número que se estaba optimizando mezcla dos cosas distintas.** De todo lo que el juez marca como
"inventado", al clasificarlo por sección: **21 señalamientos son sobre S u O** —el defecto real, un
hallazgo afirmado que nadie constató— y **21 son sobre el PLAN o el ANÁLISIS**, donde proponer un
estudio o nombrar un fármaco es exactamente el trabajo de un plan. Marcar "menciona afoxolaner en el
Plan" como invento es un error del juez, no un defecto de la nota.

Eso reconcilia los dos instrumentos, que parecían contradecirse: el juez dice 17-21 de 40 y el auditor
de producción —que sólo mira S y O— señala 4 de 40. Con el recall medido del auditor (~1/3), su 4
implica unas **12 de 40 notas con un hallazgo falso real en S u O**: grave, pero la mitad de lo que
sugería el titular.

**Antes de probar una cuarta variante hay que arreglar la métrica**: una rúbrica que cuente sólo
fabricación en S/O, que es lo que tiene consecuencias legales. Optimizar contra un número que mezcla
el defecto con el comportamiento correcto es cómo se llega a tres empates seguidos.
"""
import json

from app.generation.generate import (
    CLINICAL_SYSTEM_PROMPT,
    _format_literature,
    parse_note_response,
)
from app.generation.llm_client import LLMClient

# Llamada 1: S y O, SIN literatura a la vista. El prompt no menciona la palabra "literatura" ni
# "evidencia" a propósito: no hay nada que citar y nombrarlo invita a traer conocimiento de fondo.
SO_SYSTEM = (
    "Eres un asistente clínico veterinario que transcribe una consulta a las dos primeras secciones "
    "de una nota SOAP. Tu ÚNICA fuente es la transcripción: no tenés ninguna otra información y no "
    "debés completar el cuadro con lo que sabés de la enfermedad.\n\n"
    "- subjective: lo que el dueño o cuidador RELATA (motivo, evolución, lo que notó en casa), en los "
    "términos en que lo dijo.\n"
    "- objective: SOLO lo que el veterinario constató en esta consulta — lo que palpó, auscultó, midió "
    "o vio, y resultados de estudios que se mencionen. Si no se tomó un dato, no lo completes.\n\n"
    "NO muevas un dato de una sección a la otra: son la PROCEDENCIA del dato. Si la fiebre la midió el "
    "veterinario va en O, no en S; si el dueño dijo que 'estaba caliente', va en S, no en O.\n"
    "NO ASCIENDAS el relato a un signo con nombre propio: 'ojos saltones' no es 'exoftalmos', 'camina "
    "raro' no es 'marcha de conejo', 'se manchó la cucha' no es 'hematuria'. Y no cambies el sitio ni "
    "el grado: 'petequias en la piel' no es 'petequias gingivales'.\n"
    "Si la transcripción no dice que se hizo un examen, NO escribas su resultado. Un O corto y fiel es "
    "mejor que uno completo e inventado.\n\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"subjective": "", "objective": ""}'
)

# Llamada 2: A y P, con la literatura. Reusa el prompt de producción (que ya trae las reglas de citas,
# lenguaje de posibilidad y dosis) y le agrega que S y O ya están escritos y no se tocan.
AP_EXTRA = (
    "\n\nLAS SECCIONES S Y O YA ESTÁN ESCRITAS y te las paso como dato: NO las reescribas ni las "
    "corrijas, y no agregues hallazgos de examen que no estén ahí. Tu tarea es el análisis y el plan. "
    "Devolvé `subjective` y `objective` EXACTAMENTE como te llegaron.\n"
)


def _json_de(raw: str) -> dict:
    import re
    m = re.search(r"\{.*\}", raw or "", re.S)
    if not m:
        return {}
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return {}


def genera_split(transcript, literature, patient, severe_allergens):
    """Dos llamadas: S/O sin literatura, después A/P con literatura. Devuelve (soap, citations, flag).

    Reusa `parse_note_response` para la verificación y el renumerado de citas, así que esa parte es
    idéntica a producción: lo único que cambia es de dónde salen los textos.
    """
    ficha = (f"- especie: {patient.species or '?'}; peso: {patient.weight_kg or '?'} kg; "
             f"edad: {patient.age_years or '?'} años")
    alergias = ", ".join(severe_allergens) if severe_allergens else "ninguna conocida"

    # --- Llamada 1: S y O, a ciegas de la literatura ---
    so_user = (f"CONTEXTO DEL PACIENTE:\n{ficha}\n\n"
               f"TRANSCRIPCIÓN DE LA CONSULTA:\n{(transcript or '').strip() or '(vacía)'}")
    so = _json_de(LLMClient().complete(SO_SYSTEM, so_user, max_tokens=1200))
    subjective = str(so.get("subjective", ""))
    objective = str(so.get("objective", ""))

    # --- Llamada 2: A y P, con la literatura y con S/O como dato cerrado ---
    ap_user = (
        f"CONTEXTO DEL PACIENTE:\n{ficha}\n"
        f"- alergias severas conocidas: {alergias} (ADVERTIR antes de cualquier plan)\n\n"
        f"TRANSCRIPCIÓN DE LA CONSULTA:\n{(transcript or '').strip() or '(vacía)'}\n\n"
        f"S (subjetivo) YA ESCRITO: {subjective}\n"
        f"O (objetivo) YA ESCRITO: {objective}\n\n"
        f"LITERATURA RECUPERADA (cita SOLO estos chunk_id):\n{_format_literature(literature)}"
    )
    raw_ap = LLMClient().complete(CLINICAL_SYSTEM_PROMPT + AP_EXTRA, ap_user, max_tokens=4000)
    data = _json_de(raw_ap)
    soap_ap = data.get("soap") or {}

    # Se reconstruye el JSON con S y O de la PRIMERA llamada —no de la segunda, que pudo reescribirlos
    # igual— y se pasa por el parseo de producción para verificar y renumerar las citas.
    reconstruido = json.dumps({
        "soap": {"subjective": subjective, "objective": objective,
                 "assessment": str(soap_ap.get("assessment", "")),
                 "plan": str(soap_ap.get("plan", ""))},
        "citations": data.get("citations") or [],
        "allergy_transcript_flag": bool(data.get("allergy_transcript_flag", False)),
    }, ensure_ascii=False)
    return parse_note_response(reconstruido, literature)


def genera_actual(transcript, literature, patient, severe_allergens):
    """La generación de producción: una sola llamada. Se importa para no duplicarla."""
    from app.generation.generate import generate_note
    return generate_note(transcript, literature, patient, severe_allergens)


GENERADORES = {
    "actual": genera_actual,
    "split": genera_split,
}


def genera_reparado(transcript, literature, patient, severe_allergens):
    """Generación de producción + el PASE DE REPARACIÓN determinístico sobre S y O.

    Es lo que corre hoy en `phantom.suggest()`: se genera igual, se calcula con el glosario qué
    términos clínicos nombra la nota que la consulta no contiene, y si hay alguno se pide reformular
    con las palabras de la consulta. La reparación se rechaza si borró en vez de reformular o si no
    bajó los términos sin respaldo.
    """
    from app.generation.generate import generate_note
    from app.generation.transcript_fidelity import repair_sections

    soap, citations, flag = generate_note(transcript, literature, patient, severe_allergens)
    reparado = repair_sections(soap.subjective, soap.objective, transcript)
    if reparado:
        soap = soap.model_copy(update={"subjective": reparado[0], "objective": reparado[1]})
    return soap, citations, flag


GENERADORES["reparado"] = genera_reparado
