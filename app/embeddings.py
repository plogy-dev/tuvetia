"""Cliente de embeddings agnóstico. Modelo/dimensión de env (EMBEDDING_MODEL / EMBEDDING_DIM).

Decisión: Cohere embed-v4 (multilingüe, recuperación cross-lingual ES->EN). Corpus y
patient_embeddings usan el MISMO modelo y dimensión. Cambiar de modelo obliga a re-embeddizar todo.
"""
from app.config import get_settings


class EmbeddingClient:
    def __init__(self):
        s = get_settings()
        self.provider = getattr(s, "embedding_provider", "cohere")
        self.model = s.embedding_model
        self.dim = s.embedding_dim
        self.api_key = s.embedding_api_key

    def embed(self, texts: list[str], input_type: str = "search_document") -> list[list[float]]:
        """Devuelve un vector por texto (dimensión = self.dim).

        TODO (Claude Code): wire Cohere embed-v4. Usa input_type 'search_document' al indexar el
        corpus y 'search_query' al embeddizar la consulta del Tier 2. Mantén el cuerpo detrás de
        esta interfaz para poder cambiar de proveedor sin tocar el flujo.
        """
        raise NotImplementedError("wire del proveedor de embeddings (Cohere embed-v4)")
