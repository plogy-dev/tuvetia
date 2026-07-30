"""FastAPI: rutas de Athos. /health está implementado; el resto llama a los módulos."""
from fastapi import FastAPI, Header, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.config import get_settings
from app.auth import verify_jwt, resolve_clinic_id
from app.models import (
    ChatRequest,
    PhantomSuggestRequest,
    PhantomSuggestResponse,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedChunkLite,
    TranscribeRequest,
    TranscribeResponse,
    WhatsappSuggestRequest,
    WhatsappSuggestResponse,
)
from app.phantom import suggest as phantom_suggest_service
from app.streaming_transcription import run_live_session
from app.transcription import transcribe as transcribe_service
from app.whatsapp_reply import suggest_reply
from app.chat import stream_answer
from app.generation.evidence_judge import judge_evidence
from app.retrieval.cascade import build_and_retrieve
from app.trace.logs import log_retrieval

settings = get_settings()
app = FastAPI(title="Athos RAG service")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _auth_token(token: str, clinic_id: str) -> tuple[str, str]:
    """Verifica el JWT y confirma la membresía. Devuelve (user_id, clinic_id).

    Recibe el token pelado porque el WebSocket no lo manda en una cabecera `Authorization`: el
    navegador no puede ponerle cabeceras a `new WebSocket()`, así que viaja en el primer mensaje.
    """
    user_id = verify_jwt(token)
    return user_id, resolve_clinic_id(user_id, clinic_id)


def _auth(authorization: str | None, clinic_id: str) -> tuple[str, str]:
    """Extrae el bearer, verifica el JWT y confirma la membresía. Devuelve (user_id, clinic_id)."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="falta Authorization: Bearer")
    return _auth_token(authorization.split(" ", 1)[1], clinic_id)


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


@app.post("/athos/retrieve", response_model=RetrieveResponse)
def athos_retrieve(body: RetrieveRequest, authorization: str | None = Header(default=None)):
    """Retrieval para el agente de Next (tool search_clinical_evidence): cascada + juez, sin redacción.

    Corre la cascada con el Tier 2 solapado sobre el A->B (`build_and_retrieve`, varios segundos
    menos que el camino serial: el front aborta a los 20s) y pasa el resultado por el juez de
    evidencia. Devuelve los mejores chunks con extracto y la banda `evidence_level` — el agente
    cita esas fuentes o dice que no hay evidencia SEGÚN LA BANDA, no según `passed` (saturado).
    """
    user_id, clinic_id = _auth(authorization, body.clinic_id)
    query, chunks, passed = build_and_retrieve(body.question, body.species)
    # Juez semántico, mismo criterio que el Fantasma: `passed` está saturado (True en 187/187) y
    # el prompt del agente cuelga su "no hay evidencia suficiente" de esta respuesta. Falla abierta.
    verdict = judge_evidence(body.question, chunks if passed else [])
    # Traza SIEMPRE (sin patient_id queda NULL): la bandeja y la consulta general del agente son
    # la mayoría de su tráfico, y sin log no se puede medir la calidad del canal agéntico.
    log_retrieval(clinic_id, "agent", (query.raw or "")[:1000], list(query.concepts),
                  [c.chunk_id for c in chunks], max((c.score for c in chunks), default=0.0),
                  passed, user_id=user_id, patient_id=body.patient_id)
    return RetrieveResponse(
        passed=passed,
        evidence_level=verdict.band,
        chunks=[
            RetrievedChunkLite(
                chunk_id=c.chunk_id,
                source=c.source,
                locator=c.locator,
                score=c.score,
                excerpt=c.content[:600],
            )
            for c in chunks[:8]
        ],
    )


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


@app.websocket("/athos/transcribe/live")
async def athos_transcribe_live(ws: WebSocket):
    """Transcripción EN VIVO: el navegador manda audio y recibe el texto mientras habla.

    El endpoint por lotes (`POST /athos/transcribe`) sigue existiendo y es la **red de seguridad**:
    si esta sesión falla, el servidor manda `fallback:true` y el navegador transcribe al cerrar,
    exactamente como antes. Protocolo y decisiones: `app/streaming_transcription.py`.
    """
    await run_live_session(ws, autenticar=_auth_token)


@app.post("/athos/whatsapp/suggest", response_model=WhatsappSuggestResponse)
def athos_whatsapp_suggest(body: WhatsappSuggestRequest,
                           authorization: str | None = Header(default=None)):
    """Borrador de respuesta de WhatsApp para la bandeja (agent_mode=review).

    Athos redacta; el vet edita y aprueba antes de enviar — este endpoint NUNCA envía.
    Guardrails en el prompt: sin claims clinicos cerrados, sin inventar datos de la clinica.
    """
    _user_id, _clinic_id = _auth(authorization, body.clinic_id)
    draft = suggest_reply([m.model_dump() for m in body.messages], body.owner_name)
    return WhatsappSuggestResponse(draft=draft)
