import time
from dataclasses import dataclass
from typing import Protocol

from openai import AsyncOpenAI


@dataclass(frozen=True)
class ProviderResult:
    text: str
    provider: str
    model: str
    latency_ms: int
    input_tokens: int | None = None
    output_tokens: int | None = None


class AIProvider(Protocol):
    async def generate(self, prompt: str, model: str, temperature: float) -> ProviderResult: ...


class DevelopmentProvider:
    """Deterministic provider for development and tests; it is not an LLM."""

    async def generate(self, prompt: str, model: str, temperature: float) -> ProviderResult:
        del temperature
        return ProviderResult(
            text=f"DEV_RESPONSE: {prompt}",
            provider="development",
            model=model or "development",
            latency_ms=0,
        )


class OpenAIProvider:
    def __init__(self, api_key: str, default_model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._default_model = default_model

    async def generate(self, prompt: str, model: str, temperature: float) -> ProviderResult:
        started = time.perf_counter()
        response = await self._client.responses.create(
            model=self._default_model if model == "configured-default" else model,
            input=prompt,
            temperature=temperature,
        )
        latency_ms = round((time.perf_counter() - started) * 1000)
        usage = response.usage
        return ProviderResult(
            text=response.output_text,
            provider="openai",
            model=response.model,
            latency_ms=latency_ms,
            input_tokens=None if usage is None else usage.input_tokens,
            output_tokens=None if usage is None else usage.output_tokens,
        )
