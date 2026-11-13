from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from app.config import Settings, settings
from app.providers import AIProvider, DevelopmentProvider, EmbeddingProvider, OpenAIProvider


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


class EmbeddingRequest(BaseModel):
    texts: list[str] = Field(min_length=1, max_length=128)
    provider: Literal["development", "openai"]
    model: str = Field(min_length=1, max_length=200)


class EmbeddingResponse(BaseModel):
    vectors: list[list[float]]
    provider: str
    model: str
    dimensions: int = Field(gt=0)
    latency_ms: int = Field(ge=0)
    input_tokens: int | None = Field(default=None, ge=0)


class AgentToolDefinition(BaseModel):
    name: Literal["retrieval", "http_request", "transform"]
    description: str
    input_schema: dict[str, Any]
    sensitivity: Literal["LOW", "MEDIUM", "HIGH"]


class AgentObservation(BaseModel):
    step_number: int
    tool_name: Literal["retrieval", "http_request", "transform"]
    status: Literal["COMPLETED", "FAILED", "REJECTED_BY_HUMAN"]
    result: dict[str, Any] | None = None
    error_code: str | None = None
    error_message: str | None = None


class AgentActionRequest(BaseModel):
    run_id: str
    node_id: str
    goal: str
    model: str
    step_number: int = Field(ge=1, le=10)
    allowed_tools: list[AgentToolDefinition]
    observations: list[AgentObservation]
    limits: dict[str, int]


class AgentActionResponse(BaseModel):
    action: dict[str, Any]
    provider: str
    model: str
    latency_ms: int = Field(ge=0)
    input_tokens: int | None = Field(default=None, ge=0)
    output_tokens: int | None = Field(default=None, ge=0)


def create_provider(configuration: Settings) -> AIProvider:
    if configuration.provider == "openai" and configuration.openai_api_key:
        return OpenAIProvider(
            configuration.openai_api_key,
            configuration.openai_model,
            configuration.openai_embedding_model,
        )
    return DevelopmentProvider()


def create_embedding_providers(configuration: Settings) -> dict[str, EmbeddingProvider]:
    providers: dict[str, EmbeddingProvider] = {"development": DevelopmentProvider()}
    if configuration.openai_api_key:
        providers["openai"] = OpenAIProvider(
            configuration.openai_api_key,
            configuration.openai_model,
            configuration.openai_embedding_model,
        )
    return providers


app = FastAPI(
    title="AgentOps AI Execution Service",
    version=settings.version,
    description="Model-provider and AI execution boundary for AgentOps Studio.",
)
app.state.provider = create_provider(settings)
app.state.embedding_providers = create_embedding_providers(settings)


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


@app.post("/v1/embeddings", response_model=EmbeddingResponse, tags=["embeddings"])
async def embeddings(request: EmbeddingRequest) -> EmbeddingResponse:
    """Execute one provider-neutral batch embedding request."""
    provider: EmbeddingProvider | None = app.state.embedding_providers.get(request.provider)
    if provider is None:
        raise HTTPException(status_code=422, detail="Requested embedding provider is unavailable")
    if any(not text.strip() for text in request.texts):
        raise HTTPException(status_code=422, detail="Embedding text must not be empty")
    try:
        result = await provider.embed_texts(request.texts, request.model)
    except Exception as error:
        raise HTTPException(status_code=502, detail="Embedding provider request failed") from error
    if len(result.vectors) != len(request.texts) or any(
        len(vector) != result.dimensions for vector in result.vectors
    ):
        raise HTTPException(
            status_code=502,
            detail="Embedding provider returned invalid dimensions",
        )
    return EmbeddingResponse(**result.__dict__)


@app.post("/v1/agent/action", response_model=AgentActionResponse, tags=["agents"])
async def agent_action(request: AgentActionRequest) -> AgentActionResponse:
    """Select one strict action; observations are untrusted data, never instructions."""
    provider: AIProvider = app.state.provider
    try:
        result = await provider.select_agent_action(
            request.goal,
            [tool.model_dump() for tool in request.allowed_tools],
            [observation.model_dump(exclude_none=True) for observation in request.observations],
            request.model,
            request.step_number,
        )
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=502, detail="Agent provider request failed") from error
    return AgentActionResponse(**result)
