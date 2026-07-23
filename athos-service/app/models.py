"""Modelos de datos (contratos de API y estructuras internas)."""
from datetime import datetime
from pydantic import BaseModel, Field


class SOAP(BaseModel):
    subjective: str = ""
    objective: str = ""
    assessment: str = ""
    plan: str = ""


class Citation(BaseModel):
    chunk_id: str
    doc_id: str
    locator: str | None = None
    source: str | None = None
    url: str | None = None                 # link directo al artículo (del corpus: PubMed/DOI)
    title: str | None = None               # título del documento (para citar "un estudio de … dice …")
    year: int | None = None                # año de publicación

    @classmethod
    def from_chunk(cls, chunk: "RetrievedChunk") -> "Citation":
        """Construye la cita desde el chunk recuperado (fuente AUTORITATIVA: el corpus, no el LLM).
        El modelo solo dice QUÉ chunk cita; url/title/year/locator/source salen del metadata real."""
        md = chunk.metadata or {}
        raw_year = md.get("year")
        try:
            year = int(raw_year) if raw_year not in (None, "") else None
        except (TypeError, ValueError):
            year = None
        return cls(
            chunk_id=chunk.chunk_id, doc_id=chunk.doc_id, locator=chunk.locator, source=chunk.source,
            url=md.get("url"), title=md.get("titulo") or md.get("title"), year=year,
        )


class RetrievedChunk(BaseModel):
    """Un chunk recuperado del corpus (global)."""
    chunk_id: str
    doc_id: str
    content: str
    locator: str | None = None
    source: str | None = None
    score: float = 0.0
    metadata: dict = Field(default_factory=dict)


class StructuredQuery(BaseModel):
    """Resultado del paso A->B: consulta lista para la cascada."""
    concepts: list[str] = Field(default_factory=list)      # glossary_term ids canónicos
    mesh: list[str] = Field(default_factory=list)
    species: str | None = None                              # de la ficha del paciente
    category: str | None = None
    language: str = "en"
    raw: str = ""
    distilled: bool = False                                 # hubo hueco de glosario -> se usó el LLM liviano


class PatientContext(BaseModel):
    """Contexto del paciente (por clínica). Estructurado + semántico."""
    patient_id: str
    species: str | None = None
    weight_kg: float | None = None
    age_years: float | None = None
    severe_allergies: list[str] = Field(default_factory=list)
    medications: list[str] = Field(default_factory=list)
    history_snippets: list[str] = Field(default_factory=list)  # de patient_embeddings


# ---- Contratos de API ----
class ChatRequest(BaseModel):
    question: str
    patient_id: str
    clinic_id: str


class ConditionAlert(BaseModel):
    """Alerta de condición clínica relevante detectada en la nota (hermana del gate de alergia, pero
    NUNCA bloqueante). Determinística desde el assessment; el `detail` (panel 'afectaciones en este
    paciente') lo genera la IA aparte — pendiente de presupuesto."""
    condition: str                            # etiqueta (ES) para mostrar, p.ej. "Diabetes mellitus"
    mesh: str | None = None                   # descriptor canónico (consistencia con el corpus)
    severity: str = "warning"                 # info | warning (informativa; el bloqueo es solo alergia)
    source: str = "assessment"                # de dónde se detectó
    detail: str | None = None                 # panel por paciente -> IA (pendiente de presupuesto)


class PhantomSuggestRequest(BaseModel):
    consultation_id: str
    clinic_id: str


class PhantomSuggestResponse(BaseModel):
    note_id: str
    status: str = "draft"
    soap: SOAP
    allergy_gate_triggered: bool = False       # DURO: desde allergies.severity='severe'
    allergy_transcript_flag: bool = False       # red del modelo (mención en la consulta)
    insufficient_evidence: bool = False
    citations: list[Citation] = Field(default_factory=list)
    alerts: list[ConditionAlert] = Field(default_factory=list)  # condiciones relevantes (no bloqueantes)
    ai_model: str = ""
    ai_generated_at: datetime | None = None


class TranscribeRequest(BaseModel):
    consultation_id: str
    clinic_id: str


class TranscribeResponse(BaseModel):
    transcript_id: str
    full_text: str
    stt_model: str
