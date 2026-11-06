from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from AI_-prefixed environment variables."""

    model_config = SettingsConfigDict(env_prefix="AI_")
    service_name: str = "ai-service"
    version: str = "0.1.0"
    provider: Literal["development", "openai"] = "development"
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"


settings = Settings()
