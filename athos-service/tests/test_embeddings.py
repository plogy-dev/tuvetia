"""Fail-fast del cliente de embeddings: un Cohere lento o caído no bloquea el path de consulta."""
from types import SimpleNamespace

import httpx
import pytest

import app.embeddings as emb
from app.embeddings import EmbeddingClient, EmbeddingError, EmbeddingUnavailable
from app.models import StructuredQuery


def _fake_settings():
    return SimpleNamespace(embedding_provider="cohere", embedding_model="embed-v4.0",
                           embedding_dim=1024, embedding_api_key="test-key")


def test_timeout_se_traduce_a_embedding_unavailable_sin_reintento(monkeypatch):
    """Un timeout de red NO se reintenta (fail-fast) y sube como EmbeddingUnavailable, que es
    EmbeddingError -> retrieve() degrada a Tier 1 en vez de romper el request."""
    monkeypatch.setattr(emb, "get_settings", _fake_settings)
    client = EmbeddingClient(timeout_s=6.0)
    llamadas = {"n": 0}

    def _lento(**kwargs):
        llamadas["n"] += 1
        raise httpx.ReadTimeout("Cohere tardó demasiado")

    client._client = SimpleNamespace(embed=_lento)
    with pytest.raises(EmbeddingUnavailable):
        client.embed(["hipertiroidismo felino"], input_type="search_query")
    assert llamadas["n"] == 1                            # sin reintentos: fail-fast
    assert issubclass(EmbeddingUnavailable, EmbeddingError)


def test_tier2_usa_timeout_corto(monkeypatch):
    """El embed de la consulta (Tier 2) se construye con QUERY_EMBED_TIMEOUT_S (~6s), no con el
    tope largo de la ingesta: producción nunca espera un embed lento."""
    import app.retrieval.cascade as csc
    csc._query_vector_cached.cache_clear()  # el LRU no debe servir un vector de otro test
    capturado = {}

    class FakeClient:
        def __init__(self, timeout_s=60.0):
            capturado["timeout_s"] = timeout_s

        def embed(self, texts, input_type):
            capturado["input_type"] = input_type
            return [[0.0] * 4]

    monkeypatch.setattr(emb, "EmbeddingClient", FakeClient)
    monkeypatch.setattr(csc, "_vector_search", lambda vector, limit: [])
    csc.tier2_vector_fallback(StructuredQuery(raw="vómito en gato"), {})
    assert capturado["timeout_s"] == csc.QUERY_EMBED_TIMEOUT_S
    assert csc.QUERY_EMBED_TIMEOUT_S <= 6.0              # tope corto: degrada rápido a Tier 1
    assert capturado["input_type"] == "search_query"
