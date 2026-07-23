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
    ai_model: str = ""
    ai_generated_at: datetime | None = None


class TranscribeRequest(BaseModel):
    consultation_id: str
    clinic_id: str


class TranscribeResponse(BaseModel):
    transcript_id: str
    full_text: str
    stt_model: str
