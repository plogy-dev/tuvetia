"""Cliente LLM multi-proveedor: ruteo y parseo del path OpenAI-compatible (DeepSeek). Mock httpx."""
import httpx

from app.generation.llm_client import LLMClient


def test_openai_complete_arma_payload_y_parsea_content(monkeypatch):
    """Path OpenAI-compat: system como primer mensaje, base_url sin doble slash, Bearer, y devuelve
    el `content` ignorando `reasoning_content`."""
    captured = {}

    class FakeResp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "hola", "reasoning_content": "pensando"}}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None, timeout=None):
            captured.update(url=url, headers=headers, json=json, timeout=timeout)
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", FakeClient)
    c = LLMClient(provider="openai", base_url="https://api.deepseek.com/", model="deepseek-chat",
                  api_key="k")
    out = c.complete("SYS", "USR", max_tokens=100)

    assert out == "hola"                                            # ignora reasoning_content
    assert captured["url"] == "https://api.deepseek.com/chat/completions"  # rstrip del slash
    assert captured["headers"]["Authorization"] == "Bearer k"
    j = captured["json"]
    assert j["model"] == "deepseek-chat" and j["stream"] is False
    assert j["messages"][0] == {"role": "system", "content": "SYS"}
    assert j["messages"][-1] == {"role": "user", "content": "USR"}
    # LA garantía que permite desplegar la cascada con demos en vivo: el CUERPO REAL al primario
    # lleva el thinking desactivado. Sin esta línea, borrar `**self._extra_body()` del cuerpo
    # dejaba 209 pruebas en verde mientras DeepSeek volvía a razonar ~30 s antes del primer token
    # (auditoría 2026-07-30: el test que decía fijar el cuerpo solo probaba el helper aislado).
    assert j["thinking"] == {"type": "disabled"}
    # El timeout viaja POR PETICIÓN (el cliente es compartido/keep-alive): default del redactor.
    assert captured["timeout"] == 120.0


def test_google_complete_no_manda_thinking(monkeypatch):
    """El cuerpo REAL a Gemini va pelado: `thinking` le produce HTTP 400 (Unknown name)."""
    captured = {}

    class FakeResp:
        status_code = 200

        def json(self):
            return {"choices": [{"message": {"content": "hola"}, "finish_reason": "stop"}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None, timeout=None):
            captured.update(url=url, headers=headers, json=json)
            return FakeResp()

    monkeypatch.setattr(httpx, "Client", FakeClient)
    out = LLMClient(provider="google", model="gemini-3.6-flash", api_key="k").complete("SYS", "USR")

    assert out == "hola"
    assert "thinking" not in captured["json"]
    assert captured["url"].endswith("/openai/chat/completions")  # base URL por defecto de Google


def test_respuesta_vacia_o_cortada_levanta(monkeypatch):
    """`content` vacío o `finish_reason=length` NO son un éxito: si se devolvieran como si lo
    fueran, la cascada no probaría la alternativa — el modo de fallo más probable con Gemini,
    que gasta el presupuesto razonando antes del content."""
    import pytest

    respuestas = [
        {"choices": [{"message": {"content": ""}, "finish_reason": "length"}]},
        {"choices": [{"message": {}, "finish_reason": "stop"}]},
        {"choices": [{"message": {"content": "trunca"}, "finish_reason": "length"}]},
    ]

    for cuerpo in respuestas:
        class FakeResp:
            status_code = 200

            def json(self, _c=cuerpo):
                return _c

        class FakeClient:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers=None, json=None, timeout=None):
                return FakeResp()

        monkeypatch.setattr(httpx, "Client", FakeClient)
        with pytest.raises(RuntimeError):
            LLMClient(provider="openai", base_url="https://x", model="m", api_key="k").complete(
                "SYS", "USR")


def test_openai_stream_yields_content_e_ignora_reasoning_y_pasa_historial(monkeypatch):
    captured = {}
    lines = [
        'data: {"choices":[{"delta":{"reasoning_content":"pensando"}}]}',
        'data: {"choices":[{"delta":{"content":"Hola"}}]}',
        'data: {"choices":[{"delta":{"content":" mundo"}}]}',
        "data: [DONE]",
        "",
    ]

    class FakeStream:
        status_code = 200

        def iter_lines(self):
            return iter(lines)

    class FakeStreamCtx:
        def __enter__(self):
            return FakeStream()

        def __exit__(self, *a):
            return False

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def stream(self, method, url, headers=None, json=None, timeout=None):
            captured.update(method=method, url=url, json=json)
            return FakeStreamCtx()

    monkeypatch.setattr(httpx, "Client", FakeClient)
    c = LLMClient(provider="openai", base_url="https://api.deepseek.com", model="deepseek-chat",
                  api_key="k")
    hist = [{"role": "user", "content": "p"}, {"role": "assistant", "content": "r"}]
    out = "".join(c.stream("SYS", "USR", history=hist))

    assert out == "Hola mundo"                                     # solo content, en orden
    j = captured["json"]
    assert j["stream"] is True and captured["method"] == "POST"
    assert j["messages"][0]["role"] == "system"
    assert j["messages"][1:3] == hist                             # el historial va antes del turno
    assert j["messages"][-1] == {"role": "user", "content": "USR"}


def test_complete_rutea_a_openai_segun_provider(monkeypatch):
    """El dispatch elige el path por provider (sin llamar a Anthropic)."""
    c = LLMClient(provider="openai", base_url="x", api_key="k", model="m")
    monkeypatch.setattr(c, "_openai_complete", lambda s, u, mt: "OPENAI_PATH")
    assert c.complete("s", "u") == "OPENAI_PATH"
