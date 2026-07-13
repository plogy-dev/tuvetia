"""Configuración del servicio. TODO viene de variables de entorno (nada hardcodeado)."""
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase / DB
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_role_key: str = ""
    supabase_jwt_secret: str = ""
    database_url: str = ""

    # Motores de IA (parametrizables)
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


@lru_cache
def get_settings() -> Settings:
    return Settings()
