"""Alertas de condición clínica (parte DETERMINÍSTICA de las alertas del Phantom).

Detecta condiciones/diagnósticos relevantes en el `assessment` de la nota (sin IA) y las devuelve
como `alerts[]`, hermanas del gate de alergia pero NUNCA bloqueantes. El texto del panel
"afectaciones en este paciente" (`detail`) lo genera la IA aparte — pendiente de presupuesto.

Diseño: curaduría explícita (frases ES por condición) en vez de dejarlo al LLM. Determinístico y
testeable sin DB ni red.
"""
import re
import unicodedata

from app.models import ConditionAlert, PatientContext

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
