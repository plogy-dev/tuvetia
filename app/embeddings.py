"""Cliente de embeddings agnóstico. Modelo/dimensión de env (EMBEDDING_MODEL / EMBEDDING_DIM).

Decisión: Cohere embed-v4 (multilingüe, recuperación cross-lingual ES->EN). Corpus y
patient_embeddings usan el MISMO modelo y dimensión. Cambiar de modelo obliga a re-embeddizar todo.

Nota TLS: la red de dev intercepta TLS (proxy/AV re-firma certificados). Usamos el trust store del
SO (ssl.create_default_context) para que httpx confíe en la CA corporativa, igual que uv --system-certs.
"""
import ssl
import time
from functools import lru_cache

import httpx

from app.config import get_settings

_MAX_429_RETRIES = 3
_RETRY_SLEEP_S = 20


class EmbeddingError(Exception):
    """Base de errores de embeddings que deben DETENER una corrida de ingesta."""


class EmbeddingQuotaExceeded(EmbeddingError):
    """Cohere devolvió 429 de forma persistente: se alcanzó el límite (p.ej. cuota trial)."""


class EmbeddingAuthError(EmbeddingError):
    """Credencial inválida/insuficiente (401/403)."""


@lru_cache
def _tls_context() -> ssl.SSLContext:
    # La red de dev usa un proxy MITM cuya CA tiene Basic Constraints no-crítico; OpenSSL 3 la
    # rechaza. `truststore` delega la verificación al SO (tolerante, como el navegador/pip). En
    # entornos sin truststore o sin CA corporativa, cae al contexto estándar.
    try:
        import truststore
        return truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        return ssl.create_default_context()


class EmbeddingClient:
    def __init__(self):
        s = get_settings()
        self.provider = getattr(s, "embedding_provider", "cohere")
        self.model = s.embedding_model
        self.dim = s.embedding_dim
        self.api_key = s.embedding_api_key
        self._client = None
        self.total_billed_tokens = 0  # acumulado real (para el guard de presupuesto)

    def _cohere(self):
        if self._client is None:
            import cohere
            self._client = cohere.ClientV2(
                api_key=self.api_key,
                httpx_client=httpx.Client(verify=_tls_context(), timeout=60.0),
            )
        return self._client

    def embed(self, texts: list[str], input_type: str = "search_document") -> list[list[float]]:
        """Devuelve un vector por texto (dimensión = self.dim).

        input_type: 'search_document' al indexar el corpus; 'search_query' al embeddizar la
        consulta del Tier 2. Reintenta ante 429 (rate limit) y traduce errores a EmbeddingError.
        """
        if not texts:
            return []
        client = self._cohere()
        last: Exception | None = None
        for attempt in range(_MAX_429_RETRIES):
            try:
                resp = client.embed(
                    texts=texts,
                    model=self.model,
                    input_type=input_type,
                    embedding_types=["float"],
                    output_dimension=self.dim,
                )
                self.total_billed_tokens += _billed_tokens(resp, texts)
                floats = getattr(resp.embeddings, "float", None)
                if floats is None:
                    floats = getattr(resp.embeddings, "float_")
                return [list(v) for v in floats]
            except Exception as e:  # noqa: BLE001
                last = e
                status = getattr(e, "status_code", None)
                msg = str(e).lower()
                if status in (401, 403):
                    raise EmbeddingAuthError(f"Cohere rechazó la credencial: {e}") from e
                if status == 429 or "429" in msg or "rate limit" in msg or "quota" in msg:
                    if attempt < _MAX_429_RETRIES - 1:
                        time.sleep(_RETRY_SLEEP_S)
                        continue
                    raise EmbeddingQuotaExceeded(f"Cohere 429 tras reintentos: {e}") from e
                raise
        raise EmbeddingQuotaExceeded(f"Cohere 429 tras reintentos: {last}")


def _billed_tokens(resp, texts: list[str]) -> int:
    """Tokens facturados por Cohere en la llamada (para el guard de presupuesto)."""
    try:
        return int(resp.meta.billed_units.input_tokens)
    except Exception:  # noqa: BLE001
        return sum(max(1, len(t) // 4) for t in texts)  # estimación de respaldo


_SHARED_CLIENT = None


def get_client() -> EmbeddingClient:
    """Cliente compartido: acumula `total_billed_tokens` entre llamadas (guard de presupuesto)."""
    global _SHARED_CLIENT
    if _SHARED_CLIENT is None:
        _SHARED_CLIENT = EmbeddingClient()
    return _SHARED_CLIENT
