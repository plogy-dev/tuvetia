"""Chat: citas honestas por referencia numerada [n]. Determinístico, sin LLM ni DB."""
import app.chat as chat
from app.chat import _cited_from_answer, _format_numbered, _thread_history, stream_answer
from app.models import PatientContext, RetrievedChunk, StructuredQuery


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
    monkeypatch.setattr(chat, "build_query",
                        lambda q, s: StructuredQuery(raw=q, concepts=["Vomiting"], species=s))
    chunk = RetrievedChunk(chunk_id="c1", doc_id="D1", content="feline gastritis ...", score=0.9)
    monkeypatch.setattr(chat, "retrieve", lambda q: ([chunk], True))
    monkeypatch.setattr(chat, "severe_allergies", lambda c, p: [])
    monkeypatch.setattr(chat, "load_thread", lambda c, p, n=8: [
        {"role": "user", "content": "pregunta previa"},
        {"role": "assistant", "content": "respuesta previa [1]"}])
    monkeypatch.setattr(chat, "log_retrieval", lambda *a, **k: "rid")
    logged_roles: list[str] = []
    monkeypatch.setattr(chat, "log_message",
                        lambda clinic, uid, pid, role, content: logged_roles.append(role) or "mid")
    captured: dict = {}

    class FakeLLM:
        def __init__(self, *a, **k):
            pass

        def stream(self, system, user, max_tokens=1500, history=None):
            captured["history"] = history
            captured["user"] = user
            yield "Compatible con X [1]."

    monkeypatch.setattr(chat, "LLMClient", FakeLLM)

    events = list(stream_answer("nueva pregunta", "luna", "clinic-a"))

    assert captured["history"] == [
        {"role": "user", "content": "pregunta previa"},
        {"role": "assistant", "content": "respuesta previa [1]"}]
    assert "nueva pregunta" in captured["user"]        # el turno actual va como prompt, no en el hist
    assert "user" in logged_roles and "assistant" in logged_roles
    assert any('"type": "done"' in e for e in events)
