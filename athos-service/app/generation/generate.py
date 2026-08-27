"""Paso B->A (sección 11.7): la única IA de verdad. Redacta sobre el contexto entregado.

Lenguaje de posibilidad, NUNCA diagnóstico definitivo, citas mapeadas a chunks, sin dosis si
faltan datos. En Modo Fantasma: UNA sola llamada que devuelve SOAP + citas + allergy_flag.

Diseño testeable: el armado del prompt (`build_note_prompt`) y el parseo/verificación de la
respuesta (`parse_note_response`) son determinísticos y se prueban sin LLM; `generate_note` solo
orquesta la (única) llamada al modelo en el medio.
"""
import json
import logging
import re

from app.generation.allergy_gate import transcript_mentions_allergy
from app.generation.citations import verify_citations
from app.generation.llm_client import RespuestaVaciaError
from app.generation.provider_cascade import REDACCION, ProviderCascade
from app.models import SOAP, Citation, PatientContext, RetrievedChunk

log = logging.getLogger(__name__)

_MAX_CHUNK_CHARS = 1200  # presupuesto acotado por chunk en el prompt

CLINICAL_SYSTEM_PROMPT = (
    "Eres un asistente clínico veterinario. Responde SOLO con base en el contexto entregado. "
    "Usa lenguaje de posibilidad ('compatible con', 'sugestivo de'); NUNCA des un diagnóstico "
    "definitivo. No propongas dosis si faltan especie, peso o edad. Advierte alergias severas antes "
    "de un plan.\n\n"
    "La LITERATURA entregada YA fue recuperada por su relevancia a este caso. Tu tarea es APOYARTE "
    "en ella: por cada afirmación clínica del assessment y del plan, identifica el/los chunk(s) que "
    "la respaldan y cítalos por su `chunk_id`. Basta con que UN chunk respalde o sea pertinente a una "
    "afirmación para citarlo — no exijas una coincidencia perfecta ni que cubra todo el caso. En la "
    "práctica, si el cuadro es reconocible en la literatura, deberías citar al menos una fuente. "
    "Cita SOLO chunk_id presentes en la literatura entregada; nunca inventes fuentes. Deja "
    "`citations` en [] ÚNICAMENTE si NINGÚN chunk se relaciona con el cuadro clínico (hueco real de "
    "literatura).\n\n"
    # ── LA NOTA NO HABLA DE SÍ MISMA ───────────────────────────────────────────────────────────
    #
    # Acá decía «solo en ese caso indícalo en el assessment», y eso producía exactamente lo que el
    # cliente llamó «poco profesional» (27-ago, con captura): el vet cerraba una consulta y la
    # pantalla lo recibía con dos campos vacíos y dos llenos de negaciones — «No hay suficiente
    # información…», «No es posible proponer un plan…» — más un marcador «[sin literatura
    # suficiente]» repetido, que parece un error de sistema.
    #
    # La instrucción tenía sentido cuando la pantalla no avisaba nada. Hoy `lib/evidencia.ts`
    # muestra la banda del juez arriba de la nota, con su explicación redactada para un veterinario.
    # O sea que el modelo estaba DUPLICANDO ese aviso, peor escrito, y adentro de los campos
    # clínicos — que es texto que ENTRA A LA HISTORIA si el vet aprueba.
    #
    # La regla queda al revés: los campos llevan clínica o no llevan nada. La advertencia de
    # evidencia es de la interfaz, y va una sola vez.
    # ── S Y O NO NECESITAN LITERATURA, Y ESO NUNCA SE DIJO ────────────────────────────────────
    #
    # Medido el 27-ago sobre las 51 notas generadas: 8 sin SUBJETIVO y 7 sin OBJETIVO, y esas 7 son
    # exactamente las que traen una disculpa en el análisis. O sea que cuando el modelo no encuentra
    # literatura no se abstiene sólo del análisis —donde abstenerse es correcto— sino que se abstiene
    # de TODO, y deja vacío lo que sí podía escribir.
    #
    # Y podía: S es lo que dijo el titular y O lo que el vet observó. Los dos salen de la
    # TRANSCRIPCIÓN y del cuaderno, no de la literatura. El prompt hablaba de citas y de chunks de
    # punta a punta y nunca dijo esto, así que la regla «responde sólo con base en el contexto» se
    # leía como «sin literatura, no respondas nada».
    #
    # Es la mitad que faltaba del arreglo de la nota vacía: sin esto, prohibirle disculparse sólo
    # cambia cuatro campos con excusas por cuatro campos en blanco.
    "SUBJECTIVE y OBJECTIVE SALEN DE LA TRANSCRIPCIÓN Y DEL CUADERNO, NUNCA de la literatura, y no "
    "llevan citas: subjective es el motivo y el relato del titular; objective son los hallazgos del "
    "examen y las mediciones. Si la transcripción tiene contenido clínico, ESCRIBILOS aunque no "
    "haya literatura ninguna — abstenerse por falta de evidencia aplica al assessment y al plan, "
    "que son donde se afirma algo, no a lo que simplemente se dijo y se observó.\n\n"
    "NUNCA expliques tus propias limitaciones dentro de la nota. No escribas frases como 'no hay "
    "suficiente información', 'no es posible proponer', 'sin literatura suficiente' ni marcadores "
    "entre corchetes que no sean un chunk_id. Si no podés afirmar nada en un campo, dejalo VACÍO "
    "(\"\"): un campo vacío es una nota que el veterinario completa; una disculpa es texto que "
    "tiene que borrar antes de escribir. El sistema ya le informa aparte del nivel de evidencia.\n"
    "Además, DENTRO del texto del assessment y del plan, marca cada afirmación respaldada con su "
    "referencia entre corchetes [chunk_id] inmediatamente después de la afirmación (el sistema la "
    "convertirá en numeración [n] para el veterinario).\n\n"
    "Devuelve EXCLUSIVAMENTE un objeto JSON válido (sin texto adicional, sin ```), con esta forma:\n"
    '{"soap": {"subjective": "", "objective": "", "assessment": "", "plan": ""}, '
    '"citations": [{"chunk_id": "", "doc_id": "", "locator": "", "source": ""}], '
    '"allergy_transcript_flag": false}\n'
    "IMPORTANTE: `allergy_transcript_flag` es INDEPENDIENTE de la literatura y debes evaluarlo "
    "SIEMPRE, incluso cuando te abstengas por falta de evidencia. Ponlo en true si la TRANSCRIPCIÓN "
    "menciona CUALQUIER alergia del paciente (aunque dejes citations en []); en false solo si no se "
    "menciona ninguna."
)


def _format_literature(literature: list[RetrievedChunk]) -> str:
    lines = []
    for c in literature:
        content = (c.content or "")[:_MAX_CHUNK_CHARS]
        lines.append(f"[{c.chunk_id}] fuente={c.source or '?'} loc={c.locator or '?'}\n{content}")
    # SIN LITERATURA, UNA INSTRUCCIÓN — NO UN TOKEN CON FORMA DE DATO.
    #
    # Decía "(sin literatura suficiente)", y el modelo lo copiaba TAL CUAL adentro de la nota: la
    # captura del cliente del 27-ago muestra «[sin literatura suficiente]» dos veces, entre
    # corchetes, en los campos clínicos — leyéndose como una cita o como un error de sistema. Un
    # relleno con pinta de contenido, puesto en la sección de literatura, invita justo a eso.
    return "\n\n".join(lines) if lines else (
        "No se recuperó literatura para este caso. Redactá lo que la transcripción sostenga y dejá "
        "`citations` en []. NO menciones esta ausencia en el texto de la nota."
    )


def build_note_prompt(transcript: str, literature: list[RetrievedChunk], patient: PatientContext,
                      severe_allergens: list[str],
                      system_prompt: str | None = None,
                      notebook: str = "") -> tuple[str, str]:
    """Arma (system, user) para la nota SOAP. Determinístico y testeable sin LLM.

    `system_prompt` sustituye el de producción — es el punto de entrada del A/B de prompts
    (`scripts/calidad/phantom_ab.py`), que corre variantes en paralelo y por eso necesita pasarlo como
    argumento y no mutar el global del módulo.

    `notebook` es el CUADERNO del veterinario: lo que escribió a mano durante la consulta
    (`consultations.notebook`). Va en su propia sección y sólo si tiene contenido, por dos razones:

      · **No es transcripción.** Lo dictó el criterio del vet, no el micrófono. Mezclarlo con lo
        hablado le haría atribuir al titular cosas que dijo el veterinario para sí mismo.
      · **Vale más que lo hablado cuando se contradicen.** Un peso anotado a mano es una medición; el
        mismo peso dicho al pasar puede ser una estimación. Por eso el prompt lo dice explícito.

    Vacío por defecto: una consulta sin cuaderno arma el mismo prompt que antes, carácter por
    carácter, y las mediciones ya hechas del Fantasma siguen siendo comparables.
    """
    ficha = (f"- especie: {patient.species or '?'}; peso: {patient.weight_kg or '?'} kg; "
             f"edad: {patient.age_years or '?'} años")
    # LA ADVERTENCIA DE ALERGIAS SÓLO SE PIDE CUANDO HAY QUÉ ADVERTIR.
    #
    # La línea decía siempre «(ADVERTIR antes de cualquier plan)», también con la lista vacía, y el
    # modelo obedecía: en la captura del 27-ago el plan terminaba con «Se recuerda advertir sobre
    # alergias severas antes de cualquier intervención, aunque no se reportan conocidas en el
    # paciente» — una advertencia sobre nada, en una nota que ya estaba vacía de clínica.
    #
    # El GATE de alergia severa NO se toca y sigue siendo determinístico (`allergy_gate.py`, regla
    # nº3): esto es sólo qué se le pide al redactor cuando la ficha no tiene ninguna.
    alergias = (
        f"{', '.join(severe_allergens)} (ADVERTIR antes de cualquier plan)"
        if severe_allergens
        else "ninguna conocida (no hace falta mencionarlo en la nota)"
    )
    # El cuaderno sólo aparece si tiene contenido: sin él, el prompt queda IDÉNTICO al de siempre y
    # las mediciones ya tomadas del Fantasma siguen siendo comparables.
    cuaderno = (
        "NOTAS DEL VETERINARIO (escritas a mano durante la consulta; ante contradicción con lo "
        "hablado, PRIMAN estas):\n"
        f"{notebook.strip()}\n\n"
    ) if notebook.strip() else ""
    user = (
        "CONTEXTO DEL PACIENTE:\n"
        f"{ficha}\n"
        f"- alergias severas conocidas: {alergias}\n\n"
        f"{cuaderno}"
        "TRANSCRIPCIÓN DE LA CONSULTA:\n"
        f"{transcript.strip() or '(vacía)'}\n\n"
        "LITERATURA RECUPERADA (cita SOLO estos chunk_id):\n"
        f"{_format_literature(literature)}"
    )
    return (system_prompt or CLINICAL_SYSTEM_PROMPT), user


def _extract_json(text: str) -> dict:
    """Extrae el objeto JSON de la respuesta (tolera fences o texto alrededor)."""
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        m = re.search(r"\{.*\}", text or "", re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except json.JSONDecodeError:
                return {}
        return {}


_UUID_RE = re.compile(
    r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE
)
# Grupo de referencia cruda de chunk que el modelo deja en el texto: "(chunk_id: uuid[, uuid])" o
# "[uuid[; uuid]]". Se reemplaza por los marcadores [n] de las citas (o se elimina si no mapea).
_CHUNK_REF_RE = re.compile(
    r"\s*(?:\(\s*chunk_id[^)]*\)|\[\s*" + _UUID_RE.pattern
    + r"(?:\s*[;,]\s*" + _UUID_RE.pattern + r")*\s*\])",
    re.IGNORECASE,
)


def _renumber_refs(text: str, idx: dict[str, int]) -> str:
    """Reemplaza las referencias crudas de chunk_id del texto por marcadores [n] (n = posición en la
    lista final de citas), para que el front las muestre como citas enlazadas. Una referencia que no
    mapea a ninguna cita se elimina (ruido ilegible)."""
    def repl(m: "re.Match[str]") -> str:
        return "".join(
            f"[{idx[u.group(0).lower()]}]"
            for u in _UUID_RE.finditer(m.group(0))
            if u.group(0).lower() in idx
        )
    return _CHUNK_REF_RE.sub(repl, text)


# ── LA RED, PORQUE EL PROMPT ES UNA INSTRUCCIÓN Y NO UNA GARANTÍA ───────────────────────────────
#
# El prompt ya le pide al modelo que no explique sus limitaciones dentro de la nota. Un prompt no
# obliga: el 26-ago quedó medido en este mismo repo que pedir por prompt lo que se puede imponer por
# código falla en una fracción de los casos (el guard de dosis existe por eso). Y acá la fracción que
# falla es texto que ENTRA A LA HISTORIA CLÍNICA si el vet aprueba sin leer.
#
# Se recortan sólo frases que hablan DEL SISTEMA, nunca clínica. Por eso los patrones son literales
# y anclados: «no es posible determinar la especie» es clínica y se queda; «no es posible proponer un
# plan debido a la ausencia de literatura» es el sistema disculpándose y se va.
#
# Si el campo queda vacío, mejor: un campo vacío es una nota que el vet completa, y la pantalla ya
# le informa del nivel de evidencia por su cuenta (`lib/evidencia.ts`).
_DISCULPAS = re.compile(
    r"(?:^|(?<=[.\n]))\s*[^.\n]*?"
    r"(?:no hay (?:suficiente )?informaci[oó]n|no es posible (?:proponer|evaluar|determinar un)"
    r"|sin literatura suficiente|no se recuper[oó] literatura"
    r"|ausencia de (?:informaci[oó]n cl[ií]nica|literatura))"
    r"[^.\n]*\.?",
    re.IGNORECASE,
)
# El marcador que el modelo copiaba del relleno viejo, por si vuelve por otra vía.
_MARCADOR = re.compile(r"\[\s*sin literatura suficiente\s*\]", re.IGNORECASE)


def _sin_disculpas(texto: str) -> str:
    """Saca del campo las frases en que el sistema habla de sí mismo. Ver el bloque de arriba."""
    limpio = _MARCADOR.sub("", texto)
    limpio = _DISCULPAS.sub("", limpio)
    # Espacios y puntuación huérfana que deja el recorte.
    limpio = re.sub(r"\s{2,}", " ", limpio).strip()
    return re.sub(r"^[\s.;,]+", "", limpio).strip()


def parse_note_response(text: str, literature: list[RetrievedChunk]) -> tuple[SOAP, list[Citation], bool]:
    """Parsea la respuesta del modelo y VERIFICA las citas contra la literatura recuperada
    (descarta fuentes inventadas). Además NUMERA las citas en el texto del SOAP ([n]) para que el
    front las enlace. Determinístico. Devuelve (soap, citations, allergy_flag)."""
    data = _extract_json(text)
    s = data.get("soap") or {}
    soap = SOAP(
        subjective=_sin_disculpas(str(s.get("subjective", ""))),
        objective=_sin_disculpas(str(s.get("objective", ""))),
        assessment=_sin_disculpas(str(s.get("assessment", ""))),
        plan=_sin_disculpas(str(s.get("plan", ""))),
    )
    cited = [
        Citation(chunk_id=str(c["chunk_id"]), doc_id=str(c.get("doc_id", "")),
                 locator=c.get("locator"), source=c.get("source"))
        for c in (data.get("citations") or [])
        if isinstance(c, dict) and c.get("chunk_id")
    ]
    verified = verify_citations(text, cited, literature)
    # Rescata chunk_id citados INLINE en el texto que estén en la literatura pero que el modelo no
    # listó en `citations` — para no perder una cita real ni dejar la referencia sin numerar.
    by_id = {c.chunk_id.lower(): c for c in literature}
    seen = {c.chunk_id.lower() for c in verified}
    for cid in (u.lower() for u in _UUID_RE.findall(f"{soap.assessment}\n{soap.plan}")):
        if cid in by_id and cid not in seen:
            verified.append(Citation.from_chunk(by_id[cid]))
            seen.add(cid)
    # Reemplaza las referencias crudas por marcadores [n] (n = posición en `verified`).
    idx = {c.chunk_id.lower(): i + 1 for i, c in enumerate(verified)}
    # El subjetivo también pasa por acá. No debería citar literatura —es el relato del dueño— pero el
    # modelo lo hace igual, y al quedar fuera el `chunk_id` crudo sobrevivía: medido el 2026-07-29,
    # una nota llegó con `[2fa4dac8-2a34-4d03-85d7-f44f93780c34]` visible en la S de la historia
    # clínica. `_renumber_refs` lo convierte en `[n]` si mapea a una cita y lo borra si no.
    soap = SOAP(
        subjective=_renumber_refs(soap.subjective, idx),
        objective=_renumber_refs(soap.objective, idx),
        assessment=_renumber_refs(soap.assessment, idx),
        plan=_renumber_refs(soap.plan, idx),
    )
    return soap, verified, bool(data.get("allergy_transcript_flag", False))


class EmptyNoteError(RuntimeError):
    """El modelo no devolvió una nota utilizable (respuesta ilegible o vacía).

    Es un error explícito a propósito: sin esto, `_extract_json` devuelve `{}`, el SOAP sale con los
    cuatro campos en blanco y el Fantasma **inserta una nota vacía en la historia clínica** con
    `status='draft'`, sin señal de que algo falló. El veterinario abre la consulta y encuentra un
    borrador en blanco que no distingue entre "Athos falló" y "no había nada que decir". Medido el
    2026-07-29 sobre 16 transcripciones: pasó en 1 de 16 (`scripts/calidad/phantom_eval.py`).
    """


def generate_note(transcript: str, literature: list[RetrievedChunk], patient: PatientContext,
                  severe_allergens: list[str],
                  system_prompt: str | None = None,
                  task: str = REDACCION,
                  notebook: str = "") -> tuple[SOAP, list[Citation], bool]:
    """Genera la nota SOAP (Modo Fantasma) en una sola llamada. Usa LLMClient(LLM_MODEL).

    Devuelve (soap, citations, allergy_transcript_flag). El gate DURO (allergy_gate_triggered) y el
    insufficient_evidence los calcula Athos aparte (determinístico), no el modelo.

    `task` es el ROUTING POR CONSULTA (cláusula 1.5): el Fantasma pasa `DIFICIL` cuando el juez
    dictaminó cobertura *limitada*, y esa cadena puede apuntar a un modelo distinto — el que mide
    mejor en fidelidad. Ver `provider_cascade.task_para_banda`.

    Lanza `EmptyNoteError` si el modelo no devuelve una nota utilizable ni al reintentar.
    """
    system, user = build_note_prompt(transcript, literature, patient, severe_allergens,
                                     system_prompt, notebook=notebook)
    # El fallo es transitorio: medido, la misma transcripción que salió vacía generó bien en los dos
    # reintentos siguientes. Un reintento convierte el fallo duro en éxito; el segundo vacío ya no se
    # tapa, se levanta.
    for intento in (1, 2):
        # La nota SOAP + citas puede ser larga; 2000 truncaba el JSON (stop_reason=max_tokens) y el
        # parseo caía a una nota vacía. 4000 da margen para que el JSON cierre completo.
        # Cascada entre proveedores: si el primario se cae, responde la alternativa.
        # Sin `LLM_CASCADE_REDACCION` configurado se comporta igual que `LLMClient()`.
        try:
            text = ProviderCascade(task).complete(system, user, max_tokens=4000)
        except RespuestaVaciaError as e:
            # Una respuesta vacía ya no llega como "" (el cliente la levanta para que la cascada
            # pruebe la alternativa). Si TODA la cadena terminó vacía, sigue siendo el fallo
            # transitorio de siempre: se reintenta igual que antes. Un fallo HTTP sí propaga.
            log.warning("nota vacía del modelo (intento %s de 2): %s", intento, e)
            continue
        soap, citations, model_flag = parse_note_response(text, literature)
        if soap.subjective.strip() or soap.objective.strip() or soap.assessment.strip():
            break
        log.warning("nota vacía del modelo (intento %s de 2): %s chars de respuesta",
                    intento, len(text or ""))
    else:
        raise EmptyNoteError("el modelo no devolvió una nota SOAP utilizable en 2 intentos")
    # Backstop determinístico: el flag del modelo es no-determinístico y de él depende la única
    # señal de una alergia dicha en la consulta sin fila en `allergies`. OR con el escaneo del texto.
    allergy_flag = model_flag or transcript_mentions_allergy(transcript)
    return soap, citations, allergy_flag


def generate_chat_answer(question: str, literature: list[RetrievedChunk], patient: PatientContext,
                         severe_allergens: list[str]):
    """Genera la respuesta del chat de Athos (idealmente en streaming). Devuelve texto + citas."""
    raise NotImplementedError("generación de respuesta de chat (SSE) — pendiente (endpoints)")
