"""Cliente LLM agnóstico. El modelo y la key vienen de env (LLM_MODEL / LLM_API_KEY).

Proveedor decidido: Anthropic. Prompt caching en el prefijo estable (system). TLS vía el trust
store del SO (`truststore`), igual que el cliente de embeddings: la red de dev usa un proxy MITM
cuya CA rechaza OpenSSL 3. Mantener el cuerpo detrás de esta interfaz permite cambiar de proveedor
sin tocar el flujo de generación.
"""
from app.config import get_settings
from app.embeddings import _tls_context


class LLMClient:
    def __init__(self, model: str | None = None):
        s = get_settings()
        self.model = model or s.llm_model
        self.api_key = s.llm_api_key
        self._client = None

    def _anthropic(self):
        if self._client is None:
            import anthropic
            from anthropic import DefaultHttpxClient
            self._client = anthropic.Anthropic(
                api_key=self.api_key,
                http_client=DefaultHttpxClient(verify=_tls_context()),
            )
        return self._client

    def complete(self, system: str, user: str, max_tokens: int = 2000) -> str:
        """Una llamada de generación (self.model desde env). Devuelve el texto de la respuesta.

        El prompt de sistema (prefijo estable: reglas clínicas + definiciones del glosario) va con
        prompt caching. El `thinking`/`effort` se deja por defecto; se calibra con el golden set.
        """
        resp = self._anthropic().messages.create(
            model=self.model,
            max_tokens=max_tokens,
            # Tarea de salida estructurada (JSON): sin thinking -> predecible, barato, y todo el
            # presupuesto de tokens va a la respuesta (evita que el thinking la trunque).
            thinking={"type": "disabled"},
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
        )
        return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text")

    def stream(self, system: str, user: str, max_tokens: int = 1500):
        """Genera en streaming (para SSE): produce fragmentos de texto a medida que llegan.
        Sin thinking (respuesta natural citada, predecible)."""
        with self._anthropic().messages.stream(
            model=self.model,
            max_tokens=max_tokens,
            thinking={"type": "disabled"},
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user}],
        ) as s:
            yield from s.text_stream
