"""Configuración del servicio. TODO viene de variables de entorno (nada hardcodeado)."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase / DB
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""          # HS256 legacy (fallback)
    supabase_jwks_url: str = ""            # si vacío se deriva de supabase_url
    database_url: str = ""                  # DB de PACIENTE + trazas (por clínica) — el principal
    corpus_database_url: str = ""          # DB del CORPUS/glosario (global); si vacío usa database_url

    # Motores de IA (parametrizables)
    llm_provider: str = "anthropic"        # "anthropic" | "openai" (compatible: DeepSeek, Moonshot/Kimi)
    llm_base_url: str = ""                  # base URL del proveedor OpenAI-compatible (p.ej. https://api.deepseek.com)
    llm_model: str = "claude-sonnet-5"
    llm_light_model: str = "claude-haiku-4-5"
    llm_api_key: str = ""
    embedding_provider: str = "cohere"
    embedding_model: str = "embed-v4.0"
    embedding_dim: int = 1024
    embedding_api_key: str = ""

    # App
    cors_origins: str = "http://localhost:3000"
    app_env: str = "dev"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def corpus_db_url(self) -> str:
        """DB del corpus/glosario. Si no se define aparte, usa la misma que la de paciente (dev)."""
        return self.corpus_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
