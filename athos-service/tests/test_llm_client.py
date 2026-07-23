"""Cliente LLM multi-proveedor: ruteo y parseo del path OpenAI-compatible (DeepSeek). Mock httpx."""
import httpx

from app.generation.llm_client import LLMClient


def test_openai_complete_arma_payload_y_parsea_content(monkeypatch):
    """Path OpenAI-compat: system como primer mensaje, base_url sin doble slash, Bearer, y devuelve
    el `content` ignorando `reasoning_content`."""
    captured = {}

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "hola", "reasoning_content": "pensando"}}]}

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers=None, json=None):
            captured.update(url=url, headers=headers, json=json)
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
        def raise_for_status(self):
            pass

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

        def stream(self, method, url, headers=None, json=None):
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
