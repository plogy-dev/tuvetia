"""Verificación de FIDELIDAD de la nota contra el TRANSCRIPT: ¿lo que la nota afirma se dijo?

`citation_fidelity` audita el assessment y el plan contra la LITERATURA. Esto audita el subjetivo y
el objetivo contra la CONSULTA, que es un riesgo distinto y mayor: si la nota dice "abdomen doloroso
a la palpación" y en la consulta nadie palpó, eso no es una cita floja — es una **historia clínica
falsa**, firmada por el veterinario y con consecuencias legales.

Medido el 2026-07-29 sobre 40 transcripciones contra producción (`scripts/calidad/phantom_ab.py`):
**17 de 40 notas afirman al menos un hecho que la consulta no contiene.** Los patrones, de la
revisión caso por caso:
  a) HALLAZGO DE EXAMEN INVENTADO: "a la palpación la vejiga se siente más firme", "reflejo pupilar
     normal" — nadie palpó ni evaluó el reflejo. Es el más grave: se lee como constatado.
  b) ASCENSO DE TERMINOLOGÍA: el dueño dijo "ojos saltones" y la nota escribe "exoftalmos"; dijo
     "camina raro" y la nota escribe "marcha de conejo". Signos con nombre propio en O se leen como
     que alguien los examinó.
  c) ATRIBUCIÓN CRUZADA: la fiebre la midió el veterinario y la nota la pone en S como algo que
     "refirió la propietaria" (o al revés). S y O son la PROCEDENCIA del dato: cruzarlos borra qué
     se verificó y qué es relato.

Por qué vive en el código y no en el prompt: **se intentó por prompt y no funciona.** Dos variantes
que definen explícitamente S/O/A/P y prohíben el ascenso de terminología dieron, a 40 casos,
fidelidad +0,0 y firmaría 27→26 — dentro del ruido. A 16 casos parecían una mejora clara y era ruido
de corrida. Ver `scripts/calidad/prompts_nota.py`, que las conserva como evidencia.

LO QUE HACE AL ENCONTRAR ALGO, y por qué no es lo mismo que con las citas: una cita infiel se
descarta y listo, perder una fuente cuesta poco. Una afirmación clínica NO se puede borrar en
silencio — si el auditor se equivoca (y el de citas se equivoca ~1 de 6), borrar elimina un hallazgo
verdadero del expediente. Así que **no toca la nota: la señala.** La nota es un borrador que el
veterinario aprueba; decirle "estas dos frases no están en la consulta" es exactamente la información
que necesita para corregirla antes de firmar, y es coherente con "Athos propone, el vet aprueba".

**Falla ABIERTA**, igual que el juez de evidencia y el auditor de citas: si no puede opinar (error,
timeout, JSON ilegible), la nota sale sin señalamientos. Es control de calidad, no un punto de falla.
Interruptor: `TRANSCRIPT_FIDELITY_ENABLED=false`.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field

from app.config import get_settings
from app.generation.llm_client import LLMClient

log = logging.getLogger(__name__)

TRANSCRIPT_CHARS = 6000   # la consulta entera en el prompt del auditor
MAX_CLAIMS = 14           # tope de afirmaciones (acota costo y latencia)
MAX_TOKENS = 900          # mismo margen que el auditor de citas: 500 truncaba el JSON

# Mismo criterio de calibración que `citation_fidelity`: la carga de la prueba está en marcar, no en
# sostener. Un falso positivo acá le hace desconfiar al veterinario de una frase correcta, y si eso
# pasa seguido deja de leer los señalamientos — que es la única forma en que este auditor sirve.
#
# ⚠️ CALIBRACIÓN MEDIDA, y conviene no leerla de más: sobre 24 notas contra producción (2026-07-29)
# señala **4 de 89 afirmaciones (4%)**, con **precisión buena y recall pobre**: de las 4, 3 caen en
# notas que el juez de calidad marca como inventoras y sólo 1 en una nota que ve limpia; pero atrapa
# **3 de las 9** notas con invento. Es decir: **lo que señala casi siempre vale, y se le escapan dos
# tercios.** Cuesta 1,2s y no toca la nota, así que el saldo es positivo — pero NO es la solución del
# problema, es una red parcial. Que nadie lo presente como que la nota ya está auditada.
#
# Segundo intento de calibración, PEOR, para que no se repita: aclararle que documentar una ausencia
# es correcto ("sin alergias conocidas" no es invento) lo volvió permisivo con todo — bajó a 1 de 91
# (1%) y a 1 de 14 notas. La aclaración eliminó el único falso positivo y se llevó puesto el 75% de
# los aciertos. Los dos prompts están en el historial de este archivo.
#
# Y un dato sobre el instrumento que mide, no sobre el auditor: el juez de calidad contó 9/24 notas
# con invento en una corrida y 14/24 en la siguiente, con el MISMO prompt de generación. La tasa real
# de invención tiene barras de error anchas; sirve para saber que el problema es grande, no para
# afirmar un porcentaje.
VERIFY_SYSTEM = (
    "Eres un auditor de historias clínicas veterinarias. Te doy la TRANSCRIPCIÓN de una consulta y "
    "AFIRMACIONES que un asistente escribió en las secciones S (subjetivo) y O (objetivo) de la nota "
    "clínica. El veterinario va a FIRMAR esa nota y va a quedar en el expediente del paciente.\n"
    "Tu tarea: detectar las afirmaciones que la consulta NO respalda — hechos que nadie dijo ni "
    "constató, pero que la nota presenta como ocurridos.\n\n"
    "EN CASO DE DUDA, LA AFIRMACIÓN SE SOSTIENE. Marcá `sostiene: false` sólo cuando sea CLARO que "
    "el hecho no está en la consulta. Señalar una frase correcta le hace perder confianza al "
    "veterinario en el señalamiento mismo.\n\n"
    "SÍ se sostiene (NO marcar) cuando:\n"
    "  - dice lo mismo con otras palabras, resumido, u ordenado distinto;\n"
    "  - traduce el relato del dueño a lenguaje clínico SIN nombrar un signo que nadie evaluó "
    "('no come bien' -> 'hiporexia' está bien; 'camina raro' -> 'marcha de conejo' NO, porque "
    "'marcha de conejo' es un signo específico que habría que observar);\n"
    "  - deja constancia de que un dato NO se registró (peso, temperatura) y efectivamente no está;\n"
    "  - agrupa varios síntomas dichos por separado.\n\n"
    "NO se sostiene (marcar `false`) cuando:\n"
    "  - afirma un HALLAZGO DE EXAMEN que nadie hizo: una palpación, una auscultación, un reflejo, "
    "un signo vital medido, un resultado de laboratorio que la consulta no menciona;\n"
    "  - CAMBIA EL SITIO, EL GRADO O LA PRECISIÓN de un hallazgo que sí existe. Compará el detalle "
    "palabra por palabra: 'petequias en la piel' no es 'petequias gingivales'; 'se manchó la cucha' "
    "no es 'hematuria'; 'no lo puedo tocar ahí' no es 'dolor abdominal a la palpación'. Que el "
    "hallazgo vecino exista NO alcanza — en un expediente el sitio y el grado son el dato;\n"
    "  - atribuye a la boca equivocada: pone como reportado por el dueño algo que constató el "
    "veterinario, o como hallazgo del examen algo que sólo relató el dueño;\n"
    "  - da un valor, una cifra o un plazo que la consulta no contiene;\n"
    "  - afirma la AUSENCIA de algo que la consulta sí menciona ('no se evaluaron los ganglios' "
    "cuando los ganglios se evaluaron).\n\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"veredictos": [{"n": <número de la afirmación>, "sostiene": true|false}]}'
)

# Corta en fin de oración, igual que el auditor de citas: la oración es la unidad que afirma un hecho.
_SPLIT_RE = re.compile(r"(?<=[.!?;])\s+|\n+")
_CITA_RE = re.compile(r"\[\d{1,2}(?:\s*,\s*\d{1,2})*\]")
# Numeración de lista ("1. ", "- ") al inicio: el modelo escribe el objetivo en viñetas a menudo.
_VINETA_RE = re.compile(r"^\s*(?:\d{1,2}[.)]|[-*•])\s*")
MIN_CHARS = 25            # descarta fragmentos sin contenido auditable ("S:", "Sin datos.")


@dataclass(frozen=True)
class NoteClaim:
    """Una afirmación de la nota, con la sección de la que salió."""
    text: str
    section: str          # "S" o "O"


@dataclass(frozen=True)
class NoteFidelityReport:
    """Qué afirmaciones la consulta no respalda. `judged=False` = no se pudo verificar."""
    unsupported: tuple[NoteClaim, ...] = field(default_factory=tuple)
    judged: bool = False
    seconds: float = 0.0
    n_claims: int = 0

    def as_payload(self) -> list[dict[str, str]]:
        """Forma serializable para la respuesta del endpoint y el log."""
        return [{"section": c.section, "text": c.text} for c in self.unsupported]


EMPTY_REPORT = NoteFidelityReport()


def extract_note_claims(subjective: str, objective: str) -> list[NoteClaim]:
    """Parte S y O en afirmaciones auditables. Determinístico y testeable sin LLM.

    Sólo S y O: son las secciones que afirman HECHOS. El assessment interpreta y el plan propone —
    inventar ahí es otro problema, y lo cubre `citation_fidelity` contra la literatura.
    """
    claims: list[NoteClaim] = []
    for section, texto in (("S", subjective), ("O", objective)):
        for frase in _SPLIT_RE.split(texto or ""):
            limpia = _VINETA_RE.sub("", _CITA_RE.sub("", frase)).strip()
            if len(limpia) >= MIN_CHARS:
                claims.append(NoteClaim(text=limpia, section=section))
    return claims


def conceptos_agregados(texto_nota: str, transcript: str) -> dict[str, list[str]]:
    """Conceptos clínicos que la NOTA nombra y la CONSULTA no contiene en ninguna forma conocida.

    Determinístico y gratis: reusa el mismo glosario del retrieval (2.506 términos / 7.378 sinónimos,
    con el lenguaje coloquial del dueño ya curado: "no come" ↔ inapetencia, "caca blanda" ↔ diarrea).
    Si la nota dice "hepatomegalia" y la consulta no dice ni "hepatomegalia" ni ninguno de sus
    sinónimos, el concepto **entró en la redacción**, no en la consulta.

    Por qué esto y no pedirle al LLM que lo encuentre: medido, el auditor LLM sobre 150 afirmaciones
    sólo levantaba 8-21, y lo que se le escapaba era SIEMPRE el mismo patrón — el ascenso de
    terminología ("se siente grande el hígado" → "hepatomegalia palpable", "ruido tipo resorte" →
    "se palpa un ruido"). Buscar eso leyendo es justamente lo que un modelo hace mal y una comparación
    de conjuntos hace perfecto.

    NO decide que sea un invento: la consulta puede expresar el concepto con palabras que el glosario
    no conoce. Genera **candidatos** para que el LLM adjudique una lista corta y concreta en vez de
    barrer la nota entera. Devuelve {concepto: [sinónimos con los que aparece en la nota]}.
    """
    from app.glossary.resolve import _load_approved_synonyms, _normalize, match_concepts
    try:
        sinonimos = _load_approved_synonyms()
    except Exception as e:  # noqa: BLE001 — sin glosario el auditor sigue funcionando, sin la pista
        log.warning("fidelidad de nota: no se pudo cargar el glosario (%s)", e)
        return {}
    en_nota = set(match_concepts(texto_nota, None, sinonimos).concepts)
    en_consulta = set(match_concepts(transcript, None, sinonimos).concepts)
    agregados = en_nota - en_consulta
    if not agregados:
        return {}
    # Con qué palabras aparece cada concepto en la nota: es lo que se le muestra al LLM para que sepa
    # exactamente qué frase mirar, en vez de darle un nombre canónico en inglés y nada más.
    heno = f" {_normalize(texto_nota)} "
    out: dict[str, list[str]] = {}
    for s in sinonimos:
        c = s.get("canonical_en")
        if c in agregados and s.get("syn") and f" {s['syn']} " in heno:
            out.setdefault(c, [])
            if s["syn"] not in out[c]:
                out[c].append(s["syn"])
    return out


def _build_prompt(claims: list[NoteClaim], transcript: str,
                  agregados: dict[str, list[str]] | None = None) -> str:
    bloques = "\n".join(
        f"AFIRMACIÓN {i} (sección {c.section}): {c.text[:600]}" for i, c in enumerate(claims, 1))
    pista = ""
    if agregados:
        # La pista va DESPUÉS de las afirmaciones y es lo último que lee el modelo: es el punto donde
        # más rinde su atención, y es información que no puede deducir leyendo.
        lineas = "\n".join(
            f"  - «{', '.join(sins[:3])}» (concepto: {c})" for c, sins in list(agregados.items())[:8])
        pista = (
            "\n\nPISTA DETERMINÍSTICA — el sistema comparó la nota contra la consulta usando el "
            "glosario veterinario (que incluye el lenguaje coloquial del dueño) y estos términos "
            "aparecen en la NOTA sin aparecer en la CONSULTA en ninguna forma conocida:\n"
            f"{lineas}\n"
            "Mirá con atención las afirmaciones que los contienen. Puede que la consulta lo diga con "
            "palabras que el glosario no conoce —en ese caso la afirmación se sostiene— o puede que la "
            "nota haya ASCENDIDO el relato a un término clínico que nadie constató, que es el fallo "
            "más frecuente. Decidí para cada una.")
    return (f"TRANSCRIPCIÓN DE LA CONSULTA:\n{(transcript or '').strip()[:TRANSCRIPT_CHARS]}\n\n"
            f"AFIRMACIONES A AUDITAR:\n{bloques}{pista}")


_VEREDICTO_RE = re.compile(
    r'"n"\s*:\s*(\d{1,2})\s*,\s*"sostiene"\s*:\s*(true|false)', re.IGNORECASE)


def _veredictos(raw: str) -> dict[int, bool]:
    """Extrae {índice_0_based: sostiene}. Rescata los veredictos enteros si el JSON se truncó."""
    m = re.search(r"\{.*\}", raw or "", re.S)
    if m:
        try:
            data = json.loads(m.group(0))
            lista = data.get("veredictos")
            if isinstance(lista, list):
                out = {}
                for v in lista:
                    if isinstance(v, dict) and isinstance(v.get("sostiene"), bool):
                        try:
                            out[int(v.get("n", 0)) - 1] = v["sostiene"]
                        except (TypeError, ValueError):
                            continue
                if out:
                    return out
        except json.JSONDecodeError:
            pass
    rescatados = {int(n) - 1: (s.lower() == "true") for n, s in _VEREDICTO_RE.findall(raw or "")}
    if rescatados:
        log.info("fidelidad de nota: JSON incompleto, %s veredictos rescatados", len(rescatados))
    return rescatados


REPAIR_SYSTEM = (
    "Eres un asistente clínico veterinario corrigiendo las secciones S (subjetivo) y O (objetivo) de "
    "una nota clínica antes de que el veterinario la firme.\n\n"
    "Se detectó que la nota usa TÉRMINOS CLÍNICOS que la consulta no contiene. Eso convierte el "
    "relato en un hallazgo: escrito así, quien lea el expediente entiende que alguien lo constató.\n\n"
    "Tu tarea: reescribir S y O DICIENDO LO MISMO CON LAS PALABRAS DE LA CONSULTA.\n"
    "- NO BORRES información. Si el dueño dijo 'se siente grande la panza', eso va — lo que no va es "
    "convertirlo en 'hepatomegalia palpable'. Reformulá, no elimines.\n"
    "- Si un dato sólo se sostiene con el término prohibido y no hay forma de decirlo con lo que se "
    "dijo, entonces sí quitalo: no estaba en la consulta.\n"
    "- No agregues nada nuevo. No interpretes. No pases datos de S a O ni de O a S.\n"
    "- Mantené el mismo nivel de detalle y una extensión parecida.\n\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"subjective": "", "objective": ""}'
)

# Si la reparación devuelve un texto mucho más corto, reparó BORRANDO en vez de reformulando. En una
# historia clínica eso es peor que el término de más: se pierde lo que sí se dijo. Se rechaza.
MIN_RATIO_LARGO = 0.6


def repair_sections(subjective: str, objective: str, transcript: str,
                    model: str | None = None) -> tuple[str, str] | None:
    """Reescribe S y O sacando los términos clínicos que la consulta no contiene.

    Se dispara con la señal DETERMINÍSTICA (`conceptos_agregados`), no con el veredicto del auditor
    LLM, y es una decisión de diseño: el auditor acierta 78 de cada 100 señalamientos, así que
    reescribir por su veredicto tocaría una frase correcta 1 de cada 5 veces. La comparación de
    conjuntos contra el glosario, en cambio, dice algo verificable — "este término no aparece en la
    consulta ni en ninguno de sus sinónimos conocidos" — y la corrección que pide es conservadora:
    decir lo mismo con las palabras que se usaron.

    MEDIDO sobre 40 transcripciones contra producción, de forma **determinística** (sin juez):
        términos sin respaldo, total   : 28  ->  4   (−86 %)
        notas con al menos uno         : 19/40 -> 4/40
        extensión de S+O               : +15 %  <- NO reparó borrando: reformular cuesta palabras
        casos donde empeoró            : 1 de 40

    Y una nota sobre por qué se mide así y no con el juez de calidad: el juez **no puede ver este
    efecto**. Puntuando en abstracto dio firmaría 17, 20, 24 y 27 sobre 40 en cuatro corridas del
    MISMO prompt; y comparando de a pares resultó que prefiere la nota que ve **segunda** en el 78 %
    de los casos contra el 10 % cuando la ve primera — un sesgo de posición que invierte el resultado.
    La propiedad que esta función ataca es verificable sin opinión: «este término no aparece en la
    consulta ni en ninguno de sus sinónimos conocidos». Eso se cuenta, no se juzga.

    Devuelve (subjective, objective) reparados, o **None** si no había nada que reparar, si el modelo
    falló, o si la reparación no mejoró. NUNCA lanza.
    """
    agregados = conceptos_agregados(f"{subjective}\n{objective}", transcript)
    if not agregados:
        return None
    s = get_settings()
    terminos = "\n".join(f"  - «{', '.join(sins[:3])}»" for sins in agregados.values())
    user = (
        f"TRANSCRIPCIÓN DE LA CONSULTA:\n{(transcript or '').strip()[:TRANSCRIPT_CHARS]}\n\n"
        f"S (subjetivo) ACTUAL: {subjective}\n"
        f"O (objetivo) ACTUAL: {objective}\n\n"
        f"TÉRMINOS QUE NO APARECEN EN LA CONSULTA (reformulá las frases que los contienen):\n"
        f"{terminos}"
    )
    try:
        raw = LLMClient(model=model or s.note_fidelity_model or s.llm_light_model).complete(
            REPAIR_SYSTEM, user, max_tokens=1200)
        m = re.search(r"\{.*\}", raw or "", re.S)
        data = json.loads(m.group(0)) if m else {}
        nuevo_s, nuevo_o = str(data.get("subjective", "")), str(data.get("objective", ""))
    except Exception as e:  # noqa: BLE001 — la reparación es opcional, nunca rompe la nota
        log.warning("reparación de la nota: no se pudo (%s)", e)
        return None

    largo_antes = len(subjective.strip()) + len(objective.strip())
    largo_ahora = len(nuevo_s.strip()) + len(nuevo_o.strip())
    if not largo_ahora or largo_ahora < largo_antes * MIN_RATIO_LARGO:
        log.info("reparación de la nota descartada: reparó borrando (%s -> %s chars)",
                 largo_antes, largo_ahora)
        return None
    # Sólo se adopta si de verdad bajó la cantidad de términos sin respaldo. Si el modelo cambió las
    # palabras sin arreglar nada, la nota original se queda: cambiar por cambiar no es una mejora.
    restantes = conceptos_agregados(f"{nuevo_s}\n{nuevo_o}", transcript)
    if len(restantes) >= len(agregados):
        log.info("reparación de la nota descartada: no bajó los términos sin respaldo (%s -> %s)",
                 len(agregados), len(restantes))
        return None
    log.info("nota reparada: términos sin respaldo %s -> %s", len(agregados), len(restantes))
    return nuevo_s, nuevo_o


def check_note_fidelity(subjective: str, objective: str, transcript: str,
                        model: str | None = None) -> NoteFidelityReport:
    """Audita S y O contra el transcript. NUNCA lanza: ante cualquier problema falla abierta.

    NO modifica la nota — devuelve qué señalar. La decisión es del veterinario que firma.

    `model` sustituye el de producción: es el punto de entrada de `scripts/calidad/auditor_calibrar.py`,
    que compara modelos en paralelo y por eso necesita pasarlo como argumento en vez de mutar Settings.
    """
    s = get_settings()
    if not getattr(s, "transcript_fidelity_enabled", True):
        return EMPTY_REPORT
    if not (transcript or "").strip():
        # Sin consulta contra la que comparar no hay auditoría posible. No es un fallo: la nota del
        # Fantasma puede armarse desde el motivo de consulta cuando no hay transcripción.
        return EMPTY_REPORT
    claims = extract_note_claims(subjective, objective)
    if not claims:
        return NoteFidelityReport(judged=True)
    claims = claims[:MAX_CLAIMS]
    t0 = time.monotonic()
    try:
        # Candidatos determinísticos primero (gratis), para que el LLM adjudique una lista concreta.
        agregados = conceptos_agregados(f"{subjective}\n{objective}", transcript)
        raw = LLMClient(model=model or s.note_fidelity_model or s.llm_light_model).complete(
            VERIFY_SYSTEM, _build_prompt(claims, transcript, agregados), max_tokens=MAX_TOKENS)
        veredictos = _veredictos(raw)
        if not veredictos:
            # Devolver "todo verificado, sin problemas" sería afirmar una revisión que no ocurrió.
            raise ValueError("el auditor no devolvió veredictos utilizables")
        malas = tuple(claims[i] for i, sostiene in sorted(veredictos.items())
                      if sostiene is False and 0 <= i < len(claims))
        return NoteFidelityReport(unsupported=malas, judged=True,
                                  seconds=time.monotonic() - t0, n_claims=len(claims))
    except Exception as e:  # noqa: BLE001 — el auditor nunca rompe la nota
        log.warning("fidelidad de nota: no se pudo verificar (%s)", e)
        return NoteFidelityReport(seconds=time.monotonic() - t0, n_claims=len(claims))
