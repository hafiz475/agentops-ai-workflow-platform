import hashlib
import math
import re
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


@dataclass(frozen=True)
class EmbeddingResult:
    vectors: list[list[float]]
    provider: str
    model: str
    dimensions: int
    latency_ms: int
    input_tokens: int | None = None


class AIProvider(Protocol):
    async def generate(self, prompt: str, model: str, temperature: float) -> ProviderResult: ...


class EmbeddingProvider(Protocol):
    async def embed_texts(self, texts: list[str], model: str) -> EmbeddingResult: ...


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

    async def embed_texts(self, texts: list[str], model: str) -> EmbeddingResult:
        dimensions = 64
        vectors: list[list[float]] = []
        for text in texts:
            vector = [0.0] * dimensions
            for token in re.findall(r"[a-z0-9]+", text.lower()):
                digest = hashlib.sha256(token.encode("utf-8")).digest()
                index = int.from_bytes(digest[:2], "big") % dimensions
                vector[index] += -1.0 if digest[2] & 1 else 1.0
            magnitude = math.sqrt(sum(value * value for value in vector))
            if magnitude:
                vector = [value / magnitude for value in vector]
            vectors.append(vector)
        return EmbeddingResult(
            vectors=vectors,
            provider="development",
            model=model or "development-hash-v1",
            dimensions=dimensions,
            latency_ms=0,
        )


class OpenAIProvider:
    def __init__(self, api_key: str, default_model: str, default_embedding_model: str) -> None:
        self._client = AsyncOpenAI(api_key=api_key)
        self._default_model = default_model
        self._default_embedding_model = default_embedding_model

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

    async def embed_texts(self, texts: list[str], model: str) -> EmbeddingResult:
        started = time.perf_counter()
        selected_model = self._default_embedding_model if model == "configured-default" else model
        response = await self._client.embeddings.create(
            model=selected_model,
            input=texts,
            encoding_format="float",
        )
        vectors = [item.embedding for item in sorted(response.data, key=lambda item: item.index)]
        return EmbeddingResult(
            vectors=vectors,
            provider="openai",
            model=response.model,
            dimensions=len(vectors[0]) if vectors else 0,
            latency_ms=round((time.perf_counter() - started) * 1000),
            input_tokens=None if response.usage is None else response.usage.prompt_tokens,
        )
