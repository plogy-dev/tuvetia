"""Verificación de FIDELIDAD de las citas: ¿el pasaje citado sostiene lo que se afirmó?

`citations.verify_citations` comprueba la PROCEDENCIA (que el `[n]` exista en la literatura
recuperada), que es lo que impide inventar fuentes. Pero no comprueba la PERTINENCIA, y medido
sobre 24 respuestas contra producción (2026-07-29) ahí está el hueco de confianza más grande:
**18 de 24 respuestas citan al menos un pasaje que no sostiene la afirmación**. El veterinario abre
la fuente [3] esperando el respaldo y encuentra otra cosa.

Por qué vive en el código y no en el prompt: se intentó dos veces por prompt y las dos fallaron.
La variante `citas_estrictas` (pedir cita por cláusula, prohibir la cita múltiple, nombrar el caso
de la tabla) **empeoró todas las dimensiones** y subió las citas por respuesta de 6 a 8 — insistirle
sobre las citas le sube la ansiedad por citar. Ver `scripts/calidad/prompts_variantes.py`.

Los tres patrones de infidelidad, tomados de la revisión caso por caso:
  a) EXTRAPOLAR: el pasaje dice algo vecino y la afirmación lo estira ("fuerza la interpretación").
  b) TABLA COMO NARRATIVA: se cita un listado de laboratorio para sostener un pronóstico.
  c) CITA MÚLTIPLE DECORATIVA: "[1, 5, 11]" donde ninguna sostiene la afirmación entera.
Ninguno es detectable sin leer: la verificación necesita el LLM liviano.

**Falla ABIERTA**, igual que el juez de evidencia: si el verificador no puede opinar (error,
timeout, JSON ilegible), las citas quedan como estaban. Es control de calidad, no un punto de falla.
"""
import json
import logging
import re
import time
from dataclasses import dataclass, field

from app.config import get_settings
from app.generation.llm_client import LLMClient
from app.models import RetrievedChunk

log = logging.getLogger(__name__)

PASSAGE_CHARS = 900       # por pasaje en el prompt del verificador
MAX_CLAIMS = 12           # tope de afirmaciones a verificar (acota costo y latencia)
# Con 12 afirmaciones el JSON de veredictos ronda los 360 tokens: 500 quedaba al filo y en
# producción se truncó ("Expecting ',' delimiter"), lo que hacía perder la auditoría COMPLETA de esa
# respuesta. 900 da margen; `_veredictos` además tolera un cierre incompleto.
MAX_TOKENS = 900

# Calibración del umbral. La primera versión pedía "¿el pasaje sostiene la afirmación tal como está
# escrita?" y con eso descartaba el 58% de las referencias, incluso en respuestas que el juez de
# calidad puntuaba 8-9 de fundamentación: castigaba la reformulación legítima igual que la
# extrapolación. Esta versión invierte la carga de la prueba — sólo cae lo que es CLARAMENTE falso —
# y da ejemplos de lo que NO debe caer, que es donde estaba el error.
VERIFY_SYSTEM = (
    "Eres un auditor de citas de un sistema RAG veterinario. Te doy AFIRMACIONES que un asistente "
    "escribió para un veterinario, cada una con el/los PASAJE(S) que citó para respaldarla.\n"
    "Tu tarea: detectar las citas ENGAÑOSAS, es decir aquellas donde el veterinario abriría la "
    "fuente y NO encontraría nada parecido a lo que se le dijo.\n\n"
    "EN CASO DE DUDA, LA CITA SOSTIENE. Sólo marcá `sostiene: false` cuando sea CLARO que el pasaje "
    "no respalda la afirmación. Descartar una cita legítima le quita al veterinario una fuente "
    "válida, así que el error de marcar de más es tan grave como el de marcar de menos.\n\n"
    "SÍ sostiene (NO marcar como falsa) cuando:\n"
    "  - dice lo mismo con otras palabras, resumido, o traducido del inglés;\n"
    "  - el pasaje respalda la parte sustantiva y la afirmación agrega una precisión clínica menor;\n"
    "  - la afirmación es más general que el pasaje (el pasaje describe un caso y la afirmación dice "
    "'se ha descrito' o 'puede presentarse');\n"
    "  - el pasaje es de otra especie o contexto Y la afirmación lo declara ('descrito en perros', "
    "'extrapolable con cautela');\n"
    "  - de varias fuentes citadas juntas, AL MENOS UNA respalda la afirmación;\n"
    "  - el pasaje es una tabla o un conjunto de datos y la afirmación habla de la EXISTENCIA, la "
    "COOCURRENCIA o la FRECUENCIA de lo que esos datos miden (ej.: un estudio con cifras de dos "
    "patógenos a la vez SÍ respalda 'se ha reportado coinfección').\n\n"
    "NO sostiene (marcar `false`) sólo cuando:\n"
    "  - el pasaje trata un tema distinto y no dice nada parecido a la afirmación;\n"
    "  - la afirmación atribuye al pasaje una CIFRA, dosis, porcentaje o plazo que el pasaje no "
    "contiene ni de forma equivalente;\n"
    "  - la afirmación convierte un caso único en una regla de frecuencia ('el 25%', 'suele "
    "ocurrir en la mayoría') y el pasaje no da ninguna base para esa frecuencia;\n"
    "  - el pasaje es sólo una tabla de laboratorio o un listado de valores y la afirmación habla de "
    "evolución, PRONÓSTICO o respuesta al tratamiento — eso no puede estar en una tabla de valores "
    "(distinto de la existencia o la frecuencia de un hallazgo, que sí puede).\n\n"
    "Devolvé SOLO JSON válido, sin ```:\n"
    '{"veredictos": [{"n": <número de la afirmación>, "sostiene": true|false}]}'
)

_CITA_RE = re.compile(r"\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]")
# Corta en fin de oración. Los marcadores [n] van pegados a la afirmación que respaldan, así que
# la oración es la unidad natural: es donde el modelo pone la cita y donde el juez la evalúa.
_SPLIT_RE = re.compile(r"(?<=[.!?;:])\s+|\n+")


@dataclass(frozen=True)
class Claim:
    """Una afirmación del texto con las fuentes que citó."""
    text: str
    sources: tuple[int, ...]


@dataclass(frozen=True)
class FidelityReport:
    """Qué números de fuente resultaron infieles. `judged=False` = no se pudo verificar."""
    unfaithful: frozenset[int] = field(default_factory=frozenset)
    judged: bool = False
    seconds: float = 0.0
    n_claims: int = 0


EMPTY_REPORT = FidelityReport()


def extract_claims(answer: str, n_sources: int) -> list[Claim]:
    """Parte la respuesta en afirmaciones citadas: (oración, fuentes que cita).

    Determinístico y testeable sin LLM. Ignora las oraciones sin cita: no fingen respaldo, así que
    no hay nada que auditar en ellas.
    """
    claims: list[Claim] = []
    for frase in _SPLIT_RE.split(answer or ""):
        nums: list[int] = []
        for m in _CITA_RE.finditer(frase):
            for x in re.split(r"\s*,\s*", m.group(1)):
                n = int(x)
                if 1 <= n <= n_sources and n not in nums:
                    nums.append(n)
        limpia = _CITA_RE.sub("", frase).strip()
        if nums and len(limpia) >= 25:      # descarta fragmentos sin contenido auditable
            claims.append(Claim(text=limpia, sources=tuple(nums)))
    return claims


def _build_prompt(claims: list[Claim], literature: list[RetrievedChunk]) -> str:
    bloques = []
    for i, c in enumerate(claims, 1):
        pasajes = "\n".join(
            f"    PASAJE [{n}]: {(literature[n - 1].content or '')[:PASSAGE_CHARS]}"
            for n in c.sources if 1 <= n <= len(literature))
        bloques.append(f"AFIRMACIÓN {i}: {c.text[:600]}\n{pasajes}")
    return "\n\n".join(bloques)


# Un veredicto suelto dentro del JSON: {"n": 3, "sostiene": false}. Se usa para rescatar los
# veredictos completos cuando la respuesta se truncó y el objeto entero no parsea.
_VEREDICTO_RE = re.compile(
    r'"n"\s*:\s*(\d{1,2})\s*,\s*"sostiene"\s*:\s*(true|false)', re.IGNORECASE)


def _veredictos(raw: str) -> dict[int, bool]:
    """Extrae {índice_0_based: sostiene} de la respuesta del verificador.

    Intenta el JSON completo y, si está truncado o mal formado, rescata los veredictos que sí
    quedaron enteros. Perder los últimos veredictos degrada la auditoría de esa respuesta; perder
    TODOS por una coma faltante la anula, que es lo que pasaba antes.
    """
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
        log.info("fidelidad de citas: JSON incompleto, %s veredictos rescatados", len(rescatados))
    return rescatados


def _limpiar_huecos(texto: str) -> str:
    """Borrar un marcador deja basura tipográfica: espacio doble ('A  B') o espacio antes de la
    puntuación ('babesiosis .'). Se colapsa sin tocar los saltos de línea, que estructuran el SOAP."""
    texto = re.sub(r"[ \t]{2,}", " ", texto)
    return re.sub(r"[ \t]+([.,;:])", r"\1", texto)


def strip_markers(texto: str, quitar: frozenset[int] | set[int]) -> str:
    """Quita del texto los marcadores `[n]` de las fuentes que el auditor descartó.

    Sin esto el sistema queda incoherente: la lista de referencias pierde la fuente 3 pero el texto
    sigue diciendo "...según la literatura [3]", y el veterinario ve una cita que no puede abrir —
    que es exactamente la desconfianza que el auditor viene a evitar. Un `[1][3]` del que sólo cae
    el 3 conserva el 1.
    """
    if not texto or not quitar:
        return texto or ""

    def repl(m: "re.Match[str]") -> str:
        nums = [int(x) for x in re.split(r"\s*,\s*", m.group(1))]
        quedan = [n for n in nums if n not in quitar]
        return "".join(f"[{n}]" for n in quedan)

    return _limpiar_huecos(_CITA_RE.sub(repl, texto))


def drop_and_renumber(texto: str, quitar: frozenset[int] | set[int], total: int) -> str:
    """Quita los marcadores descartados y RENUMERA los que quedan, de 1 a N sin huecos.

    Lo necesita el Fantasma: ahí el `[n]` del SOAP es la posición en la lista de `citations`, así que
    si la cita 2 de 5 se cae, las siguientes tienen que correrse ([3]->[2], [4]->[3]...). En el chat
    no hace falta renumerar porque el `[n]` indexa la literatura ofrecida, que no cambia.
    """
    if not texto or not quitar:
        return texto or ""
    nuevo_de = {}
    siguiente = 1
    for n in range(1, total + 1):
        if n not in quitar:
            nuevo_de[n] = siguiente
            siguiente += 1

    def repl(m: "re.Match[str]") -> str:
        nums = [int(x) for x in re.split(r"\s*,\s*", m.group(1))]
        return "".join(f"[{nuevo_de[n]}]" for n in nums if n in nuevo_de)

    return _limpiar_huecos(_CITA_RE.sub(repl, texto))


def check_fidelity(answer: str, literature: list[RetrievedChunk]) -> FidelityReport:
    """Audita las citas de `answer`. NUNCA lanza: ante cualquier problema falla abierta."""
    s = get_settings()
    if not getattr(s, "fidelity_enabled", True):
        return EMPTY_REPORT
    claims = extract_claims(answer, len(literature))
    if not claims:
        return FidelityReport(judged=True)
    claims = claims[:MAX_CLAIMS]
    t0 = time.monotonic()
    try:
        raw = LLMClient(model=s.llm_light_model).complete(
            VERIFY_SYSTEM, _build_prompt(claims, literature), max_tokens=MAX_TOKENS)
        veredictos = _veredictos(raw)
        if not veredictos:
            # Sin veredictos no se verificó nada. Devolver "todo bien" sería afirmar una revisión
            # que no ocurrió: hay que caer a judged=False y conservar las citas.
            raise ValueError("el verificador no devolvió veredictos utilizables")
        negativos = {n for n, sostiene in veredictos.items() if sostiene is False}
        malas: set[int] = set()
        for idx in negativos:
            if 0 <= idx < len(claims):
                malas.update(claims[idx].sources)
        # Una fuente que sostiene ALGUNA afirmación no es infiel: sólo cae la que nunca sostuvo nada.
        buenas = {n for i, c in enumerate(claims) for n in c.sources if i not in negativos}
        return FidelityReport(unfaithful=frozenset(malas - buenas), judged=True,
                              seconds=time.monotonic() - t0, n_claims=len(claims))
    except Exception as e:  # noqa: BLE001 — el auditor nunca rompe la respuesta
        log.warning("fidelidad de citas: no se pudo verificar (%s)", e)
        return FidelityReport(seconds=time.monotonic() - t0, n_claims=len(claims))
