from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from app.config import settings


class ServiceStatus(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    version: str


app = FastAPI(
    title="AgentOps AI Execution Service",
    version=settings.version,
    description="Model-provider and AI execution boundary for AgentOps Studio.",
)


def status_response() -> ServiceStatus:
    return ServiceStatus(service=settings.service_name, version=settings.version)


@app.get("/health", response_model=ServiceStatus, tags=["probes"])
async def health() -> ServiceStatus:
    """Return process liveness without testing external dependencies."""
    return status_response()


@app.get("/ready", response_model=ServiceStatus, tags=["probes"])
async def ready() -> ServiceStatus:
    """Return readiness; provider dependencies will be added with real execution."""
    return status_response()
