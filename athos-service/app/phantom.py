"""Modo Fantasma (sección de integración): al cerrar la consulta, Athos genera la nota SOAP citada.

Orquesta el contrato `POST /athos/phantom/suggest`: carga transcript + contexto de paciente (por
clínica), corre la cascada, aplica el gate DURO de alergia (desde `allergies`, no el modelo),
genera la nota en UNA sola llamada, verifica citas, inserta `clinical_notes` (draft) y la
trazabilidad, y devuelve el payload. `clinic_id` siempre explícito (service_role se salta RLS).
"""
import logging
import time
from datetime import datetime, timezone

from fastapi import HTTPException
from psycopg.types.json import Json

from app.config import get_settings
from app.db import fetch_all, get_conn
from app.generation.allergy_gate import evaluate_gate
from app.generation.citation_fidelity import check_fidelity, drop_and_renumber
from app.generation.condition_alerts import detect_conditions, explain_conditions
from app.generation.dose_guard import patient_data_complete, redact_doses
from app.generation.evidence_judge import judge_evidence
from app.generation.generate import EmptyNoteError, generate_note
from app.generation.provider_cascade import modelo_usado, task_para_banda
from app.generation.transcript_fidelity import check_note_fidelity, repair_sections
from app.generation.undeclared import find_undeclared
from app.models import EVIDENCE_NONE, PhantomSuggestResponse
from app.patient_context import load_patient_context
from app.retrieval.cascade import build_and_retrieve
from app.trace.logs import log_answer, log_retrieval

log = logging.getLogger(__name__)


def _load_consultation(clinic_id: str, consultation_id: str) -> dict | None:
    rows = fetch_all(
        "select patient_id, chief_complaint from public.consultations "
        "where clinic_id = %s and id = %s",
        (clinic_id, consultation_id),
    )
    return rows[0] if rows else None


def _load_transcript(clinic_id: str, consultation_id: str) -> dict | None:
    rows = fetch_all(
        "select id, full_text from public.transcripts "
        "where clinic_id = %s and consultation_id = %s order by created_at desc limit 1",
        (clinic_id, consultation_id),
    )
    return rows[0] if rows else None


# TTL del sondeo de columnas opcionales: True se cachea PARA SIEMPRE (una columna aplicada no
# desaparece); False caduca a los 5 min -> la migración se auto-detecta sin redeploy, pero la
# query de catálogo ya no se paga en cada phantom.
_HAS_COLUMN_TTL_S = 300.0
_has_column_cache: dict[str, tuple[float, bool]] = {}


def _clinical_notes_has(column: str) -> bool:
    """¿Existe ya `column` en clinical_notes? (`alerts`: migración 0004; `evidence_level`: 0025).
    Permite desplegar el código ANTES de aplicar la migración al principal sin romper el insert
    (degrada a NO persistir esa columna)."""
    now = time.monotonic()
    cached = _has_column_cache.get(column)
    if cached is not None:
        ts, val = cached
        if val or now - ts < _HAS_COLUMN_TTL_S:
            return val
    val = bool(fetch_all(
        "select 1 from information_schema.columns where table_schema = 'public' "
        "and table_name = 'clinical_notes' and column_name = %s limit 1", (column,)))
    _has_column_cache[column] = (now, val)
    return val


def _insert_note(clinic_id, consultation_id, transcript_id, soap, citations,
                 gate_triggered, model, ai_at, alerts, evidence_level) -> str:
    cols = ["clinic_id", "consultation_id", "transcript_id", "status", "subjective", "objective",
            "assessment", "plan", "citations", "ai_generated_at", "ai_model", "allergy_gate_triggered"]
    vals = ["%s", "%s", "%s", "'draft'", "%s", "%s", "%s", "%s", "%s", "%s", "%s", "%s"]
    params = [clinic_id, consultation_id, transcript_id, soap.subjective, soap.objective,
              soap.assessment, soap.plan, Json([c.model_dump() for c in citations]),
              ai_at, model, gate_triggered]
    if _clinical_notes_has("alerts"):                     # persiste solo si la columna existe (0004)
        cols.append("alerts")
        vals.append("%s")
        params.append(Json([a.model_dump() for a in alerts]))
    if _clinical_notes_has("evidence_level"):             # idem, migración 0025
        cols.append("evidence_level")
        vals.append("%s")
        params.append(evidence_level)
    with get_conn() as conn, conn.cursor() as cur:
        cur.execute(f"insert into public.clinical_notes ({', '.join(cols)}) "
                    f"values ({', '.join(vals)}) returning id", params)
        note_id = cur.fetchone()["id"]
        conn.commit()
    return str(note_id)


def suggest(consultation_id: str, clinic_id: str, user_id: str | None = None) -> PhantomSuggestResponse:
    """Genera la sugerencia del Modo Fantasma para una consulta. Devuelve el contrato cerrado."""
    cons = _load_consultation(clinic_id, consultation_id)
    if not cons:
        raise HTTPException(status_code=404, detail="consulta no encontrada en esta clínica")
    patient_id = str(cons["patient_id"])
    tr = _load_transcript(clinic_id, consultation_id)
    transcript_text = (tr["full_text"] if tr and tr["full_text"] else "") or (cons["chief_complaint"] or "")
    transcript_id = str(tr["id"]) if tr else None

    patient = load_patient_context(clinic_id, patient_id)

    # A->B (glosario + LLM liviano de respaldo) + cascada, con el Tier 2 solapado sobre el A->B
    query, chunks, passed = build_and_retrieve(transcript_text, patient.species)

    # Gate DURO desde `allergies` (no el modelo)
    gate_triggered, severe = evaluate_gate(clinic_id, patient_id)

    # Juez de evidencia: ¿los pasajes recuperados sostienen ESTE caso? Acá va ANTES de generar (a
    # diferencia del chat, donde corre en paralelo): el Fantasma es asíncrono — se dispara al cerrar
    # la consulta y nadie espera el primer token —, así que sus ~1,8s no le cuestan a nadie y sí
    # ahorran la llamada de redacción con literatura que no viene al caso.
    verdict = judge_evidence(transcript_text, chunks if passed else [], query_mesh=list(query.mesh))

    # B->A: sin evidencia suficiente -> nota del transcript SIN literatura (insufficient_evidence)
    literature = chunks if passed and not verdict.abstains else []
    # Si el modelo no devuelve una nota utilizable, se corta acá: NO se inserta la fila. Una nota en
    # blanco en la historia clínica es peor que un error — el vet no puede distinguirla de "no había
    # nada que decir", y queda un borrador fantasma asociado a la consulta.
    try:
        # ROUTING POR CONSULTA (1.5): con cobertura `limited` la literatura cubre el cuadro sólo a
        # medias, que es donde el modelo tiende a rellenar el hueco con su propio conocimiento. Ahí
        # se escala al modelo que mide mejor en FIDELIDAD; en el resto se queda en el barato, que mide
        # mejor en utilidad. Acá se puede hacer porque el juez ya corrió (en el chat corre en paralelo
        # y esperar su veredicto costaría latencia justo en el primer token).
        soap, citations, allergy_flag = generate_note(
            transcript_text, literature, patient, severe, task=task_para_banda(verdict.band))
    except EmptyNoteError as e:
        log.error("Fantasma sin nota utilizable para consulta %s: %s", consultation_id, e)
        raise HTTPException(
            status_code=502,
            detail="el modelo no devolvió una nota utilizable; reintentá cerrar la consulta",
        ) from e
    # Gate de dosis (regla nº4): con la ficha incompleta, ninguna cifra por peso entra a la nota.
    # Va acá y no en el prompt porque medido el prompt no la cumple (ver app/generation/dose_guard).
    # La nota es un borrador que el vet aprueba: una dosis sin verificar no puede llegar a firmarse.
    if not patient_data_complete(patient.species, patient.weight_kg, patient.age_years):
        soap = soap.model_copy(update={"plan": redact_doses(soap.plan)[0],
                                       "assessment": redact_doses(soap.assessment)[0]})
    # Fidelidad de las citas: ¿el pasaje citado sostiene lo afirmado? Acá importa MÁS que en el chat,
    # porque esta nota la firma el veterinario y entra a la historia clínica. El Fantasma es asíncrono
    # (nadie espera el primer token), así que el ~1,7s del auditor no le cuesta a nadie.
    # El `[n]` del SOAP indexa la lista de `citations`, no la literatura: se audita contra esos chunks
    # y, al caer una, hay que RENUMERAR para no dejar huecos ni marcadores sin referencia detrás.
    if citations:
        por_id = {c.chunk_id: c for c in chunks}
        citados = [por_id[c.chunk_id] for c in citations if c.chunk_id in por_id]
        fid = check_fidelity(f"{soap.assessment}\n{soap.plan}", citados)
        if fid.judged and fid.unfaithful:
            total = len(citations)
            soap = soap.model_copy(update={
                "assessment": drop_and_renumber(soap.assessment, fid.unfaithful, total),
                "plan": drop_and_renumber(soap.plan, fid.unfaithful, total)})
            citations = [c for i, c in enumerate(citations, 1) if i not in fid.unfaithful]
            log.info("fidelidad de citas (Fantasma): %s de %s fuentes descartadas",
                     len(fid.unfaithful), total)
    # Fidelidad de la NOTA contra el TRANSCRIPT: ¿lo que S y O afirman se dijo en la consulta? Es el
    # riesgo más alto de todo el sistema — medido, 17 de 40 notas afirmaban un hallazgo de examen que
    # nadie hizo — y no se arregla por prompt (se probaron dos variantes, ver scripts/calidad).
    # NO corrige la nota, la SEÑALA: si el auditor se equivoca, borrar una frase saca del expediente
    # un hallazgo real. La nota es un borrador que el vet aprueba; esto le dice qué revisar antes.
    # Primero se INTENTA ARREGLAR, y sólo después se señala lo que quede. El disparador es
    # determinístico (términos clínicos que la consulta no contiene según el glosario), no el veredicto
    # del auditor: pide reformular con las palabras de la consulta, y se rechaza si reparó borrando.
    reparado = repair_sections(soap.subjective, soap.objective, transcript_text)
    if reparado:
        soap = soap.model_copy(update={"subjective": reparado[0], "objective": reparado[1]})
    fid_nota = check_note_fidelity(soap.subjective, soap.objective, transcript_text)
    if fid_nota.unsupported:
        log.info("fidelidad de nota (Fantasma): %s de %s afirmaciones sin respaldo en la consulta",
                 len(fid_nota.unsupported), fid_nota.n_claims)
    # S y O se auditan contra la CONSULTA (arriba). El análisis y el plan se auditan contra la
    # LITERATURA por `citation_fidelity`, pero eso sólo alcanza a las frases CON cita — y quedaba
    # afuera lo ejecutable sin citar. Medido sobre 40 notas: el plan afirmaba cifras de incidencia
    # como "vómitos (6.3% de los casos con fluralaner)" sin ninguna fuente detrás. Es el mismo
    # detector del chat: no censura, marca para que el vet lo revise antes de firmar.
    revisar_ap = [{"section": "A/P", "text": u["texto"], "tipo": u["tipo"]}
                  for u in find_undeclared(f"{soap.assessment}\n{soap.plan}")]
    if revisar_ap:
        log.info("Fantasma: %s afirmaciones ejecutables sin citar en análisis/plan", len(revisar_ap))
    # Honestidad del payload: aunque el retrieval pase el umbral, si la generación no ancló NINGUNA
    # cita (la literatura recuperada no sustentaba el caso), no afirmamos evidencia suficiente. Así
    # el flag es consistente con la nota (citations=[] <-> insufficient_evidence=True).
    insufficient = not literature or not citations
    # El nivel REPORTADO es el efectivo: si la nota terminó sin citas, da igual lo bien que puntuara
    # la literatura — esa nota no tiene respaldo.
    evidence_level = EVIDENCE_NONE if insufficient else verdict.band
    # Alertas de condición: detección determinística (desde el assessment) + panel "afectaciones en
    # este paciente" (una llamada LLM, grounded en la literatura; degrada a sin-detail si falla).
    alerts = explain_conditions(detect_conditions(soap.assessment, patient), patient, literature)
    # Quién generó DE VERDAD la nota: con la cascada el modelo puede variar por petición, y la nota
    # que el veterinario firma no puede registrar un modelo que no la escribió. `modelo_usado` es la
    # etiqueta que dejó la última generación (la de generate_note, que corre justo antes); si ninguna
    # cascada corrió (p. ej. nota sin literatura), cae al LLM_MODEL de siempre.
    model = modelo_usado(get_settings().llm_model)
    ai_at = datetime.now(timezone.utc)

    # Trazabilidad
    retrieval_id = log_retrieval(
        clinic_id, "phantom", (query.raw or "")[:1000], list(query.concepts),
        [c.chunk_id for c in chunks], max((c.score for c in chunks), default=0.0), passed,
        user_id=user_id, patient_id=patient_id,
    )
    note_id = _insert_note(clinic_id, consultation_id, transcript_id, soap, citations,
                           gate_triggered, model, ai_at, alerts, evidence_level)
    soap_text = f"S: {soap.subjective}\nO: {soap.objective}\nA: {soap.assessment}\nP: {soap.plan}"
    log_answer(clinic_id, retrieval_id, note_id, soap_text,
               [c.model_dump() for c in citations], insufficient, gate_triggered, model)

    return PhantomSuggestResponse(
        note_id=note_id, status="draft", soap=soap,
        allergy_gate_triggered=gate_triggered, allergy_transcript_flag=allergy_flag,
        insufficient_evidence=insufficient, evidence_level=evidence_level,
        citations=citations, alerts=alerts,
        unsupported_claims=fid_nota.as_payload() + revisar_ap,
        ai_model=model, ai_generated_at=ai_at,
    )
