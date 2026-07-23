"""FastAPI: rutas de Athos. /health está implementado; el resto llama a los módulos."""
from fastapi import FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.auth import verify_jwt, resolve_clinic_id
from app.models import (
    ChatRequest,
    PhantomSuggestRequest,
    PhantomSuggestResponse,
    TranscribeRequest,
    TranscribeResponse,
)
from app.phantom import suggest as phantom_suggest_service
from app.transcription import transcribe as transcribe_service
from app.chat import stream_answer

settings = get_settings()
app = FastAPI(title="Athos RAG service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _auth(authorization: str | None, clinic_id: str) -> tuple[str, str]:
    """Extrae el bearer, verifica el JWT y confirma la membresía. Devuelve (user_id, clinic_id)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="falta Authorization: Bearer")
    user_id = verify_jwt(authorization.split(" ", 1)[1])
    return user_id, resolve_clinic_id(user_id, clinic_id)


@app.get("/health")
def health():
    return {"status": "ok", "service": "athos"}


@app.post("/athos/chat")
def athos_chat(body: ChatRequest, authorization: str | None = Header(default=None)):
    """Chat del vet. Responde en streaming (SSE) la respuesta citada.

    Flujo (sección 11 del documento final): A->B (query_builder) -> cascada (retrieval)
    -> umbral -> fusión + gate de alergia -> B->A (generation) -> verificación de citas
    -> trazar (trace). El clinic_id va explícito hacia la DB.
    """
    user_id, clinic_id = _auth(authorization, body.clinic_id)
    return StreamingResponse(
        stream_answer(body.question, body.patient_id, clinic_id, user_id),
        media_type="text/event-stream",
    )


@app.post("/athos/phantom/suggest", response_model=PhantomSuggestResponse)
def phantom_suggest(body: PhantomSuggestRequest, authorization: str | None = Header(default=None)):
    """Lo llama el Phantom al cerrar la consulta. Athos genera, crea la nota draft y devuelve el payload.

    Contrato cerrado (ver CLAUDE.md). allergy_gate_triggered lo calcula Athos desde `allergies`
    (no el modelo). Escribe rag_answer_log con note_id.
    """
    user_id, clinic_id = _auth(authorization, body.clinic_id)
    return phantom_suggest_service(body.consultation_id, clinic_id, user_id)


@app.post("/ingest")
def ingest(authorization: str | None = Header(default=None)):
    """Admin: dispara la ingesta del corpus. TODO: proteger con una llave de admin."""
    raise NotImplementedError("implementar disparo de ingesta (sección 9)")


@app.post("/athos/transcribe", response_model=TranscribeResponse)
def athos_transcribe(body: TranscribeRequest, authorization: str | None = Header(default=None)):
    """Transcribe el audio de la consulta (Deepgram) y guarda el transcript.

    Se llama justo después de subir el audio; deja la consulta lista para
    /athos/phantom/suggest. El clinic_id se resuelve contra la membresía del usuario.
    """
    _user_id, clinic_id = _auth(authorization, body.clinic_id)
    result = transcribe_service(body.consultation_id, clinic_id)
    return TranscribeResponse(
        transcript_id=result["transcript_id"],
        full_text=result["full_text"],
        stt_model=result["stt_model"],
    )
