from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime settings loaded from environment variables."""

    model_config = SettingsConfigDict(env_prefix="AI_")
    service_name: str = "ai-service"
    version: str = "0.1.0"


settings = Settings()
