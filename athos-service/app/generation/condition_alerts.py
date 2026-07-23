"""Alertas de condición clínica (parte DETERMINÍSTICA de las alertas del Phantom).

Detecta condiciones/diagnósticos relevantes en el `assessment` de la nota (sin IA) y las devuelve
como `alerts[]`, hermanas del gate de alergia pero NUNCA bloqueantes. El texto del panel
"afectaciones en este paciente" (`detail`) lo genera la IA aparte — pendiente de presupuesto.

Diseño: curaduría explícita (frases ES por condición) en vez de dejarlo al LLM. Determinístico y
testeable sin DB ni red.
"""
import json
import re
import unicodedata

from app.models import ConditionAlert, PatientContext

_EXPLAIN_SYSTEM = (
    "Eres un asistente clínico veterinario. Para CADA condición dada, redacta 1-2 frases sobre sus "
    "afectaciones EN ESTE PACIENTE concreto (usa su ficha: especie, peso, edad). Apóyate SOLO en la "
    "LITERATURA y el contexto entregados; usa lenguaje de posibilidad ('puede', 'suele', 'conviene "
    "vigilar'), NUNCA un diagnóstico cerrado ni dosis. Si la literatura no cubre una condición, da "
    "una nota general y breve. Devuelve EXCLUSIVAMENTE JSON válido (sin texto, sin ```), con la forma:"
    '\n{"detalles": {"<etiqueta EXACTA de la condición>": "<explicación breve>"}}'
)

# Condiciones frecuentes de primera opinión que se surface-an como alerta. `aliases`: frases ES
# (se comparan como frase completa sobre el texto normalizado, sin acentos).
CONDITIONS = [
    {"label": "Diabetes mellitus", "mesh": "Diabetes Mellitus",
     "aliases": ["diabetes mellitus", "diabetes"]},
    {"label": "Enfermedad renal crónica", "mesh": "Renal Insufficiency, Chronic",
     "aliases": ["enfermedad renal cronica", "insuficiencia renal cronica", "falla renal"]},
    {"label": "Hipertiroidismo", "mesh": "Hyperthyroidism",
     "aliases": ["hipertiroidismo"]},
    {"label": "Enfermedad valvular mitral", "mesh": "Mitral Valve Insufficiency",
     "aliases": ["valvula mitral", "valvulopatia mitral", "insuficiencia mitral"]},
    {"label": "Leishmaniasis", "mesh": "Leishmaniasis",
     "aliases": ["leishmaniasis", "leishmaniosis", "leishmania"]},
    {"label": "Parvovirosis", "mesh": "Parvoviridae Infections",
     "aliases": ["parvovirus", "parvovirosis"]},
    {"label": "Dermatitis atópica", "mesh": "Dermatitis, Atopic",
     "aliases": ["dermatitis atopica", "atopia"]},
    {"label": "Otitis externa", "mesh": "Otitis Externa",
     "aliases": ["otitis externa"]},
    {"label": "Enfermedad periodontal", "mesh": "Periodontitis",
     "aliases": ["enfermedad periodontal", "periodontitis"]},
    {"label": "Hiperadrenocorticismo (Cushing)", "mesh": "Hyperadrenocorticism",
     "aliases": ["hiperadrenocorticismo", "cushing"]},
    {"label": "Pancreatitis", "mesh": "Pancreatitis",
     "aliases": ["pancreatitis"]},
]


def _norm(text: str) -> str:
    """minúsculas, sin acentos, sin puntuación, espacios colapsados (comparación estable)."""
    t = unicodedata.normalize("NFKD", (text or "").lower())
    t = "".join(c for c in t if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", " ", t)).strip()


def detect_conditions(assessment: str, patient: PatientContext | None = None) -> list[ConditionAlert]:
    """Detecta condiciones relevantes en el `assessment` (determinístico, por frase completa).

    Devuelve las alertas SIN `detail` (el panel por paciente lo llena la IA aparte). Sin duplicados,
    en el orden de CONDITIONS. `patient` se recibe para futura detección desde la ficha/medicación.
    """
    hay = f" {_norm(assessment)} "
    alerts: list[ConditionAlert] = []
    for cond in CONDITIONS:
        if any(f" {_norm(a)} " in hay for a in cond["aliases"]):
            alerts.append(ConditionAlert(condition=cond["label"], mesh=cond["mesh"],
                                         severity="warning", source="assessment"))
    return alerts


def _extract_json(text: str) -> dict:
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


def explain_conditions(alerts: list[ConditionAlert], patient: PatientContext | None,
                       literature: list) -> list[ConditionAlert]:
    """Rellena `detail` de cada alerta con una explicación breve, por paciente, en UNA sola llamada
    LLM (proveedor del env). Grounded en la literatura recuperada.

    - Sin literatura (abstención) -> no explica (detail=None): cita o se calla.
    - Ante CUALQUIER fallo del LLM (sin crédito, timeout...) degrada a las alertas sin detail: el
      panel nunca tumba el Phantom.
    """
    if not alerts or not literature:
        return alerts
    from app.generation.generate import _format_literature
    from app.generation.llm_client import LLMClient

    ficha = ("(sin ficha)" if patient is None else
             f"especie: {patient.species or '?'}; peso: {patient.weight_kg or '?'} kg; "
             f"edad: {patient.age_years or '?'} años")
    conds = "\n".join(f"- {a.condition}" for a in alerts)
    user = (f"FICHA DEL PACIENTE: {ficha}\n\nCONDICIONES A EXPLICAR:\n{conds}\n\n"
            f"LITERATURA:\n{_format_literature(literature)}")
    try:
        raw = LLMClient().complete(_EXPLAIN_SYSTEM, user, max_tokens=800)
        detalles = _extract_json(raw).get("detalles") or {}
        for a in alerts:
            d = detalles.get(a.condition)
            if isinstance(d, str) and d.strip():
                a.detail = d.strip()
    except Exception:  # noqa: BLE001 — el panel explicativo nunca debe tumbar el Phantom
        pass
    return alerts
