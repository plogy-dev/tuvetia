"""Cliente LLM agnóstico. El modelo y la key vienen de env (LLM_MODEL / LLM_API_KEY)."""
from app.config import get_settings


class LLMClient:
    def __init__(self, model: str | None = None):
        s = get_settings()
        self.model = model or s.llm_model
        self.api_key = s.llm_api_key

    def complete(self, system: str, user: str, max_tokens: int = 2000) -> str:
        """Una llamada de generación. Devuelve el texto de la respuesta.

        TODO (Claude Code): implementar contra el proveedor decidido (Anthropic), leyendo el
        modelo de self.model. Activar prompt caching en el prefijo estable (system + glosario).
        Mantener el cuerpo detrás de esta interfaz para poder cambiar de proveedor sin tocar el flujo.
        """
        raise NotImplementedError("wire del proveedor LLM (self.model desde env)")
