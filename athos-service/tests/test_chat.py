"""Chat: citas honestas por referencia numerada [n]. Determinístico, sin LLM ni DB."""
import json

import app.chat as chat
import app.generation.provider_cascade as pc
from app.chat import _cited_from_answer, _format_numbered, _thread_history, stream_answer
from app.generation.evidence_judge import ABSTAIN_MESSAGE, EvidenceVerdict
from app.models import (EVIDENCE_LIMITED, EVIDENCE_NONE, EVIDENCE_SUFFICIENT, PatientContext,
                        RetrievedChunk, StructuredQuery)


def _lit():
    return [
        RetrievedChunk(chunk_id="c1", doc_id="D1", content="renal disease ...", locator="A", source="PubMed"),
        RetrievedChunk(chunk_id="c2", doc_id="D2", content="cardiac ...", locator="B", source="PMC OA"),
        RetrievedChunk(chunk_id="c3", doc_id="D3", content="dermatology ...", locator="C", source="PubMed"),
    ]


def test_cited_solo_las_referenciadas_en_orden():
    """Devuelve solo las fuentes referenciadas por [n], en orden de aparición y sin duplicados."""
    ans = "Compatible con X [2]. También sugiere Y [1], y de nuevo [2]."
    cites = _cited_from_answer(ans, _lit())
    assert [c.chunk_id for c in cites] == ["c2", "c1"]
    assert cites[0].source == "PMC OA" and cites[0].locator == "B"


def test_cited_ignora_indices_fuera_de_rango():
    cites = _cited_from_answer("ver [9] y [2]", _lit())
    assert [c.chunk_id for c in cites] == ["c2"]


def test_cited_sin_marcadores_es_vacio():
    """Si el modelo no referencia ninguna fuente, no se adjunta ninguna cita (honesto)."""
    assert _cited_from_answer("respuesta general sin citas", _lit()) == []


def test_cited_enriquece_url_title_year_desde_el_chunk():
    """La cita del chat lleva url/title/year del corpus para que el front enlace el artículo."""
    lit = [RetrievedChunk(chunk_id="c1", doc_id="D1", content="ckd ...", locator="A", source="PubMed",
                          metadata={"url": "https://pubmed.ncbi.nlm.nih.gov/24884635/",
                                    "titulo": "CKD in cats", "year": 2020})]
    c = _cited_from_answer("compatible con enfermedad renal [1]", lit)[0]
    assert c.url == "https://pubmed.ncbi.nlm.nih.gov/24884635/"
    assert c.title == "CKD in cats" and c.year == 2020


def test_format_numbered_enumera_desde_1():
    txt = _format_numbered(_lit())
    assert "[1] fuente=PubMed" in txt
    assert "[2] fuente=PMC OA" in txt
    assert "[3] fuente=PubMed" in txt


def test_format_numbered_vacio():
    assert "sin literatura" in _format_numbered([])


# --- Memoria del hilo conversacional ---

def test_thread_history_limpia_los_extremos():
    """Debe empezar con 'user' y terminar con 'assistant' (turnos completos) y filtrar otros roles."""
    rows = [
        {"role": "assistant", "content": "saludo suelto"},   # se descarta (líder no-user)
        {"role": "user", "content": "p1"},
        {"role": "assistant", "content": "r1"},
        {"role": "user", "content": "p2"},                   # trailing user sin respuesta -> se descarta
    ]
    assert _thread_history(rows) == [
        {"role": "user", "content": "p1"}, {"role": "assistant", "content": "r1"}]


def test_thread_history_ignora_vacios_y_roles_raros():
    rows = [{"role": "system", "content": "x"}, {"role": "user", "content": "  "},
            {"role": "user", "content": "hola"}, {"role": "assistant", "content": "hey"}]
    assert _thread_history(rows) == [
        {"role": "user", "content": "hola"}, {"role": "assistant", "content": "hey"}]


def test_stream_answer_inyecta_memoria_y_loguea_ambos_roles(monkeypatch):
    """stream_answer carga el hilo previo y lo pasa al LLM como historial; la pregunta actual NO va
    en el historial (va como prompt del turno) y se loguean los roles user + assistant."""
    monkeypatch.setattr(chat, "load_patient_context",
                        lambda c, p: PatientContext(patient_id=p, species="perro"))
    chunk = RetrievedChunk(chunk_id="c1", doc_id="D1", content="feline gastritis ...", score=0.9)
    monkeypatch.setattr(chat, "build_and_retrieve", lambda texto, especie: (
        StructuredQuery(raw=texto, concepts=["Vomiting"], species=especie), [chunk], True))
    monkeypatch.setattr(chat, "load_thread", lambda c, p, n=8: [
        {"role": "user", "content": "pregunta previa"},
        {"role": "assistant", "content": "respuesta previa [1]"}])
    monkeypatch.setattr(chat, "log_retrieval", lambda *a, **k: "rid")
    logged_roles: list[str] = []
    monkeypatch.setattr(chat, "log_message",
                        lambda clinic, uid, pid, role, content: logged_roles.append(role) or "mid")
    # Sin DB ni Cohere: la memoria del paciente embebe la consulta con el cliente REAL de
    # embeddings, y este test la dejaba pasar — el guard `_sin_red` la destapó el 30-jul (antes el
    # "degrada con gracia" del Tier 2 se tragaba el AssertionError y el test pasaba en silencio).
    import app.patient_memory as pm
    monkeypatch.setattr(pm, "recall", lambda c, p, q, limit=6: [])
    monkeypatch.setattr(pm, "index_patient_memory", lambda c, p: 0)
    captured: dict = {}

    class FakeLLM:
        def __init__(self, *a, **k):
            pass

        def stream(self, system, user, max_tokens=1500, history=None):
            captured["history"] = history
            captured["user"] = user
            yield "Compatible con X [1]."

    # El chat genera vía `ProviderCascade`, que resuelve el cliente en SU módulo: parchear
    # `chat.LLMClient` ya no lo intercepta y la prueba saldría a la red de verdad.
    monkeypatch.setattr(pc, "LLMClient", FakeLLM)

    events = list(stream_answer("nueva pregunta", "luna", "clinic-a"))

    assert captured["history"] == [
        {"role": "user", "content": "pregunta previa"},
        {"role": "assistant", "content": "respuesta previa [1]"}]
    assert "nueva pregunta" in captured["user"]        # el turno actual va como prompt, no en el hist
    assert "user" in logged_roles and "assistant" in logged_roles
    assert any('"type": "done"' in e for e in events)


# --- Abstención en el chat (juez de evidencia) ---

def _run_chat(monkeypatch, *, verdict=None, tokens=("Compatible con gastritis [1].",),
              passed=True, llm=None, cuadro=None, pregunta="¿qué hago?",
              concepts=("Vomiting",), traza=None,
              cuadro_explota=False) -> tuple[list[dict], list[tuple[str, str]]]:
    """Corre stream_answer con todo el I/O mockeado. Devuelve (eventos SSE parseados, mensajes
    logueados). El juez es síncrono acá, pero en producción corre en su propio hilo: el resultado
    NO depende de quién termine primero (si el stream se adelanta, los tokens quedan retenidos).

    `traza`, si se pasa un dict, se llena con lo que el chat REALMENTE mandó a cada etapa:
    `buscados` (los textos que fueron a retrieval, en orden) y `juzgado` (los que vio el juez). Es
    lo único que distingue "se enriqueció la consulta" de "salió bien por otra razón".
    """
    t = traza if traza is not None else {}
    t.setdefault("buscados", [])
    t.setdefault("juzgado", [])

    monkeypatch.setattr(chat, "load_patient_context",
                        lambda c, p: PatientContext(patient_id=p, species="perro"))
    chunk = RetrievedChunk(chunk_id="c1", doc_id="D1", content="canine gastritis ...", score=0.9)

    def _retrieve(texto, especie):
        t["buscados"].append(texto)
        return StructuredQuery(raw=texto, concepts=list(concepts), species=especie), [chunk], passed

    monkeypatch.setattr(chat, "build_and_retrieve", _retrieve)

    # El cuadro registrado del paciente. Va mockeado aunque el defecto sea None: `concepts` por
    # defecto es sólo un signo, o sea una consulta REFERENCIAL, y sin esto stream_answer intentaría
    # abrir la DB de paciente de verdad — que bajo pytest la corta el cortafuegos de `db.py`.
    def _cuadro(c, p):
        if cuadro_explota:
            raise RuntimeError("DB caída")
        return cuadro

    monkeypatch.setattr(chat, "load_recent_assessment", _cuadro)
    monkeypatch.setattr(chat, "load_thread", lambda c, p, n=8: [])
    monkeypatch.setattr(chat, "log_retrieval", lambda *a, **k: "rid")
    logged: list[tuple[str, str]] = []
    monkeypatch.setattr(chat, "log_message",
                        lambda cl, uid, pid, role, content: logged.append((role, content)) or "mid")
    def _juez(q, lit, **kw):
        t["juzgado"].append(q)
        return verdict

    monkeypatch.setattr(chat, "judge_evidence", _juez)
    import app.patient_memory as pm                       # sin DB ni Cohere en el test
    monkeypatch.setattr(pm, "recall", lambda c, p, q, limit=6: [])
    monkeypatch.setattr(pm, "index_patient_memory", lambda c, p: 0)

    class FakeLLM:
        def __init__(self, *a, **k):
            pass

        def stream(self, system, user, max_tokens=1500, history=None):
            yield from tokens

    monkeypatch.setattr(pc, "LLMClient", llm or FakeLLM)
    events = [json.loads(e[len("data: "):]) for e in stream_answer(pregunta, "luna", "clinic-a")]
    return events, logged


def test_juez_abstiene_descarta_lo_ya_generado(monkeypatch):
    """El umbral determinístico pasa (pasa SIEMPRE: 187/187 en el banco) pero el juez dice que los
    pasajes no sostienen la consulta. Nada de lo redactado llega al vet: sale la plantilla, sin
    citas. Retener los tokens hasta el veredicto es justo lo que permite descartarlos."""
    events, logged = _run_chat(monkeypatch, verdict=EvidenceVerdict(
        band=EVIDENCE_NONE, score=1.0, judged=True, reason="otra condición"))

    textos = [e.get("text", "") for e in events if e["type"] == "token"]
    assert textos == [ABSTAIN_MESSAGE]                     # lo generado NO se emitió
    assert not any("gastritis" in t for t in textos)
    done = events[-1]
    assert done["insufficient_evidence"] is True and done["evidence_level"] == EVIDENCE_NONE
    assert done["citations"] == []
    # El hilo del paciente guarda la abstención, NUNCA el borrador descartado.
    assert [c for r, c in logged if r == "assistant"] == [ABSTAIN_MESSAGE]


def test_evidencia_limitada_responde_pero_lo_declara_antes(monkeypatch):
    """Banda intermedia: se responde, pero el aviso sale ANTES del primer token y lo emite el CÓDIGO
    (como el gate de alergia), no la buena voluntad del modelo."""
    events, _ = _run_chat(monkeypatch, verdict=EvidenceVerdict(
        band=EVIDENCE_LIMITED, score=4.0, judged=True))

    tipos = [e["type"] for e in events]
    assert tipos.index("warning") < tipos.index("token")
    assert "Evidencia limitada" in events[0]["text"]
    done = events[-1]
    assert done["evidence_level"] == EVIDENCE_LIMITED
    assert done["insufficient_evidence"] is False          # sí se responde
    assert [c["chunk_id"] for c in done["citations"]] == ["c1"]


def test_evidencia_suficiente_no_agrega_avisos(monkeypatch):
    events, _ = _run_chat(monkeypatch, verdict=EvidenceVerdict(
        band=EVIDENCE_SUFFICIENT, score=8.0, judged=True))

    assert not any(e["type"] == "warning" for e in events)
    assert events[-1]["evidence_level"] == EVIDENCE_SUFFICIENT
    assert "gastritis" in "".join(e.get("text", "") for e in events if e["type"] == "token")


def test_juez_caido_responde_igual(monkeypatch):
    """Falla abierta: si el juez no pudo juzgar (proveedor caído/timeout) NO se calla al vet."""
    events, _ = _run_chat(monkeypatch, verdict=EvidenceVerdict())   # judged=False

    assert events[-1]["evidence_level"] == EVIDENCE_SUFFICIENT
    assert "gastritis" in "".join(e.get("text", "") for e in events if e["type"] == "token")


def test_umbral_deterministico_abstiene_sin_gastar_llm(monkeypatch):
    """Si la cascada no pasa el umbral no hay literatura que juzgar: se abstiene sin llamar al LLM
    (ni al juez). Es el camino barato de 'cita o se calla'."""
    class ExplodingLLM:
        def __init__(self, *a, **k):
            raise AssertionError("sin literatura no se debe llamar al LLM")

    events, logged = _run_chat(monkeypatch, passed=False, llm=ExplodingLLM)

    assert [e.get("text") for e in events if e["type"] == "token"] == [ABSTAIN_MESSAGE]
    assert events[-1]["evidence_level"] == EVIDENCE_NONE
    assert [c for r, c in logged if r == "assistant"] == [ABSTAIN_MESSAGE]



# --- Preguntas REFERENCIALES: la condición está en la ficha, no en las palabras ------------------
#
# EL CASO REAL, con su traza. El 17-ago un vet preguntó, con Manchita en contexto, "hola que piensas
# sobre la ccondiccion de manncchita" y Athos se abstuvo. `rag_retrieval_log` lo explica: el A->B
# destiló ["cat", "feline", "clinical condition"] —ni un descriptor diagnóstico—, top_score 0,90
# contra el 1,6-1,8 de las consultas buenas, y `rag_answer_log` no tiene fila: el juez abstuvo.
#
# El juez tenía razón: con esa consulta ninguna literatura la fundamenta. Lo que faltaba era la
# consulta — y el dato estaba a un JOIN, en la nota que el propio sistema escribió 55 min antes.
# Ver `app/retrieval/referencial.py`.

CUADRO = ("Cuadro clínico compatible con vómitos crónicos en gato; diferenciales: cuerpo extraño "
          "gastrointestinal, enfermedad inflamatoria intestinal, enfermedad renal crónica.")
BIEN = EvidenceVerdict(band=EVIDENCE_SUFFICIENT, score=8.0, judged=True)


def test_pregunta_referencial_se_rebusca_con_el_cuadro_del_paciente(monkeypatch):
    """LO QUE ARREGLA EL BUG: sin condición en la pregunta, la búsqueda se rehace con la ficha."""
    t: dict = {}
    _run_chat(monkeypatch, cuadro=CUADRO, verdict=BIEN, traza=t,
              pregunta="hola que piensas sobre la ccondiccion de manncchita")

    assert len(t["buscados"]) == 2, f"se esperaban dos búsquedas, hubo {len(t['buscados'])}"
    assert t["buscados"][0] == "hola que piensas sobre la ccondiccion de manncchita"
    # La segunda ya nombra el cuadro: es la diferencia entre top_score 0,90 y una consulta útil.
    for termino in ["vómitos crónicos", "cuerpo extraño", "renal crónica"]:
        assert termino in t["buscados"][1], f"la re-búsqueda no nombra «{termino}»"


def test_el_juez_lee_la_misma_consulta_que_se_busco(monkeypatch):
    """Si el juez siguiera viendo la pregunta cruda, abstendría igual y todo esto no serviría."""
    t: dict = {}
    _run_chat(monkeypatch, cuadro=CUADRO, verdict=BIEN, traza=t,
              pregunta="hola que piensas sobre la ccondiccion de manncchita")

    assert t["juzgado"] == [t["buscados"][1]]


def test_consulta_con_condicion_concreta_NO_se_toca(monkeypatch):
    """LA FRONTERA, y es la garantía de seguridad de todo el cambio.

    Con un descriptor diagnóstico en la consulta no se rebusca ni cambia lo que ve el juez. Es lo
    que asegura que esto no mueve su calibración —187 casos medidos— en el camino bueno.
    """
    import pytest

    from app.glossary.specificity import diagnostic_descriptors
    diag = diagnostic_descriptors()
    if not diag:
        pytest.skip("sin mesh_diagnostic.json no hay descriptores que reconocer")

    t: dict = {}
    _run_chat(monkeypatch, cuadro=CUADRO, verdict=BIEN, traza=t,
              concepts=(next(iter(diag)),), pregunta="manejo de luxación patelar en perros")

    assert len(t["buscados"]) == 1, "una consulta con condición concreta no debe rebuscarse"
    assert t["juzgado"] == ["manejo de luxación patelar en perros"]


def test_sin_cuadro_registrado_se_comporta_como_antes(monkeypatch):
    """Un paciente sin notas no cambia nada: no se inventa contexto."""
    t: dict = {}
    _run_chat(monkeypatch, cuadro=None, verdict=BIEN, traza=t,
              pregunta="¿qué piensas de este paciente?")

    assert t["buscados"] == ["¿qué piensas de este paciente?"]
    assert t["juzgado"] == ["¿qué piensas de este paciente?"]


def test_leer_el_cuadro_nunca_tumba_el_chat(monkeypatch):
    """Si la ficha no se puede leer se responde igual: el enriquecimiento no es punto de falla."""
    t: dict = {}
    events, _ = _run_chat(monkeypatch, cuadro_explota=True, verdict=BIEN, traza=t,
                          pregunta="¿qué piensas de este paciente?")

    assert "gastritis" in "".join(e.get("text", "") for e in events if e["type"] == "token")
    assert len(t["buscados"]) == 1


def test_el_cuadro_llega_al_redactor_marcado_como_NO_literatura(monkeypatch):
    """El modelo necesita saber de qué hablaba la pregunta, sin que eso cuente como evidencia.

    La frontera importa: si el cuadro entrara como literatura, "cita o se calla" se rompería — se
    podría sostener una afirmación con el registro de la propia clínica en vez de con una fuente.
    """
    visto: dict = {}

    class Espia:
        def __init__(self, *a, **k):
            pass

        def stream(self, system, user, max_tokens=1500, history=None):
            visto["user"] = user
            yield "Compatible con gastritis [1]."

    _run_chat(monkeypatch, cuadro=CUADRO, verdict=BIEN, llm=Espia,
              pregunta="hola que piensas sobre la ccondiccion de manncchita")

    assert "vómitos crónicos" in visto["user"]
    assert "NO es literatura" in visto["user"]
