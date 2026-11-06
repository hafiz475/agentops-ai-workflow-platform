from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import Settings, settings
from app.providers import AIProvider, DevelopmentProvider, OpenAIProvider


class ServiceStatus(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


class GenerateRequest(BaseModel):
    run_id: str = Field(min_length=1)
    node_id: str = Field(min_length=1)
    prompt: str = Field(min_length=1)
    model: str = Field(min_length=1)
    temperature: float = Field(ge=0, le=2)


class GenerateResponse(BaseModel):
    text: str
    provider: str
    model: str
    latency_ms: int = Field(ge=0)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


def create_provider(configuration: Settings) -> AIProvider:
    if configuration.provider == "openai" and configuration.openai_api_key:
        return OpenAIProvider(configuration.openai_api_key, configuration.openai_model)
    return DevelopmentProvider()


app = FastAPI(
    title="AgentOps AI Execution Service",
    version=settings.version,
    description="Model-provider and AI execution boundary for AgentOps Studio.",
)
app.state.provider = create_provider(settings)


def status_response() -> ServiceStatus:
    return ServiceStatus(service=settings.service_name, version=settings.version)


@app.get("/health", response_model=ServiceStatus, tags=["probes"])
async def health() -> ServiceStatus:
    """Return process liveness without testing external dependencies."""
    return status_response()


@app.get("/ready", response_model=ServiceStatus, tags=["probes"])
async def ready() -> ServiceStatus:
    """Return service readiness."""
    return status_response()


@app.post("/v1/generate", response_model=GenerateResponse, tags=["generation"])
async def generate(request: GenerateRequest) -> GenerateResponse:
    """Execute one provider-neutral model generation request."""
    provider: AIProvider = app.state.provider
    try:
        result = await provider.generate(request.prompt, request.model, request.temperature)
    except Exception as error:
        raise HTTPException(status_code=502, detail="AI provider request failed") from error
    return GenerateResponse(**result.__dict__)
