"""FastAPI: rutas de Athos. /health está implementado; el resto llama a los módulos."""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Header, HTTPException, WebSocket
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.arranque import anunciar
from app.config import get_settings
from app.auth import verify_jwt, resolve_clinic_id
from app.models import (
    ChatDocumentRequest,
    ChatDocumentResponse,
    ChatRequest,
    LiveRequest,
    LiveResponse,
    PhantomSuggestRequest,
    PhantomSuggestResponse,
    RetrieveRequest,
    RetrieveResponse,
    RetrievedChunkLite,
    TranscribeRequest,
    TranscribeResponse,
)
from app.live_intelligence import analizar as analizar_en_vivo
from app.patient_context import load_patient_context
from app.phantom import suggest as phantom_suggest_service
from app.streaming_transcription import run_live_session
from app.transcription import transcribe as transcribe_service
from app.chat import stream_answer
from app.generation.evidence_judge import judge_evidence
from app.retrieval.cascade import build_and_retrieve
from app.trace.logs import log_retrieval

settings = get_settings()
@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Al arrancar, el servicio dice con qué modelos quedó y qué credenciales le faltan.

    Es lo único que separa "Railway perdió las variables" de "Athos no responde y no sabemos por
    qué": el healthcheck da verde en los dos casos. Ver `app/arranque.py`.
    """
    anunciar(get_settings())
    yield


app = FastAPI(title="Athos RAG service", lifespan=lifespan)

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


def _year_or_none(raw) -> int | None:
    """El `year` del metadata viene como texto ("2022") y a veces vacío o sucio."""
    try:
        return int(raw) if raw not in (None, "") else None
    except (TypeError, ValueError):
        return None


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
    verdict = judge_evidence(body.question, chunks if passed else [], query_mesh=list(query.mesh))
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
                # Identidad citable (estudio/revista/link): lo que el agente muestra como fuente.
                title=(c.metadata or {}).get("titulo") or (c.metadata or {}).get("title"),
                url=(c.metadata or {}).get("url"),
                year=_year_or_none((c.metadata or {}).get("year")),
                journal=(c.metadata or {}).get("fuente"),
            )
            for c in chunks[:8]
        ],
    )


@app.post("/athos/patient-memory/document", response_model=ChatDocumentResponse)
def athos_patient_memory_document(
    body: ChatDocumentRequest, authorization: str | None = Header(default=None)
):
    """Indexa en la memoria del paciente un documento adjuntado al chat del agente.

    Lo llama el front (fire-and-forget) cuando el vet adjunta un documento CON paciente en
    contexto: así el laboratorio de hoy se recuerda semánticamente en la consulta del mes que
    viene, igual que las notas aprobadas y las transcripciones. Best-effort a propósito — la
    respuesta dice si quedó indexado, pero el chat nunca depende de esto.
    """
    _, clinic_id = _auth(authorization, body.clinic_id)
    from app.patient_memory import index_chat_document
    indexed = index_chat_document(clinic_id, body.patient_id, body.nombre, body.texto)
    return ChatDocumentResponse(indexed=indexed)


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


@app.post("/athos/live", response_model=LiveResponse)
def athos_live(body: LiveRequest, authorization: str | None = Header(default=None)):
    """Notas y sugerencias MIENTRAS la consulta pasa. Ver `app/live_intelligence.py`.

    NO ESCRIBE NADA. Ni `clinical_notes`, ni `transcripts`, ni traza de respuesta: lo que sale de acá
    es un cuaderno que se mira y se descarta, no un documento clínico. La nota que entra a la
    historia sigue siendo la del cierre, con su aprobación humana (regla 5).

    EL TRANSCRIPT VIENE DEL NAVEGADOR y no de la base, porque durante la consulta todavía no está
    persistido — se guarda al cerrar. Pedirlo por `consultation_id` devolvería vacío justo mientras
    esto sirve. Lo que sí se resuelve del lado servidor es la FICHA (`clinic_id` explícito, regla 7):
    el peso y la especie gobiernan el guard de dosis, así que no pueden venir del cliente.

    LA CADENCIA NO SE DECIDE ACÁ. La decide el navegador por contenido nuevo
    (`lib/consulta-viva/disparador.ts`), con techo por consulta.
    """
    _user_id, _clinic_id = _auth(authorization, body.clinic_id)
    patient = load_patient_context(body.clinic_id, body.patient_id) if body.patient_id else None
    r = analizar_en_vivo(body.transcript, body.modo, patient=patient, motivo=body.motivo)
    return LiveResponse(**r)
