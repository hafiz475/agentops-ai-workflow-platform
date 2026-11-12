import asyncio
from types import SimpleNamespace
from typing import Any, cast

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import app, create_provider
from app.providers import DevelopmentProvider, OpenAIProvider

client = TestClient(app)


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "ai-service", "version": "0.1.0"}


def test_ready() -> None:
    assert client.get("/ready").status_code == 200


def test_development_generate_is_deterministic_and_provider_neutral() -> None:
    response = client.post(
        "/v1/generate",
        json={
            "run_id": "run-1",
            "node_id": "llm-1",
            "prompt": "Explain Docker",
            "model": "configured-default",
            "temperature": 0,
        },
    )
    assert response.status_code == 200
    assert response.json() == {
        "text": "DEV_RESPONSE: Explain Docker",
        "provider": "development",
        "model": "configured-default",
        "latency_ms": 0,
        "input_tokens": None,
        "output_tokens": None,
    }


def test_invalid_generate_payload_is_rejected() -> None:
    response = client.post("/v1/generate", json={"prompt": ""})
    assert response.status_code == 422


def test_missing_openai_key_falls_back_to_development() -> None:
    provider = create_provider(Settings(provider="openai", openai_api_key=None))
    assert isinstance(provider, DevelopmentProvider)


def test_provider_failure_is_safe_and_does_not_leak_secret() -> None:
    class FailingProvider:
        async def generate(self, prompt: str, model: str, temperature: float) -> None:
            del prompt, model, temperature
            raise RuntimeError("secret-key-value")

    original = app.state.provider
    app.state.provider = FailingProvider()
    try:
        response = client.post(
            "/v1/generate",
            json={
                "run_id": "run-1",
                "node_id": "llm-1",
                "prompt": "Explain Docker",
                "model": "configured-default",
                "temperature": 0,
            },
        )
    finally:
        app.state.provider = original
    assert response.status_code == 502
    assert response.json() == {"detail": "AI provider request failed"}
    assert "secret-key-value" not in response.text


def test_openapi_documents_generation_contract() -> None:
    schema = client.get("/openapi.json").json()
    assert "/v1/generate" in schema["paths"]
    assert "/v1/embeddings" in schema["paths"]


def test_development_embeddings_are_deterministic_and_dimensioned() -> None:
    request = {
        "texts": ["abnormal bearing vibration", "abnormal bearing vibration"],
        "provider": "development",
        "model": "development-hash-v1",
    }
    response = client.post("/v1/embeddings", json=request)
    assert response.status_code == 200
    body = response.json()
    assert body["provider"] == "development"
    assert body["model"] == "development-hash-v1"
    assert body["dimensions"] == 64
    assert len(body["vectors"]) == 2
    assert body["vectors"][0] == body["vectors"][1]
    assert len(body["vectors"][0]) == body["dimensions"]


def test_embedding_rejects_empty_text_and_unavailable_provider() -> None:
    empty = client.post(
        "/v1/embeddings",
        json={"texts": [" "], "provider": "development", "model": "development-hash-v1"},
    )
    assert empty.status_code == 422
    unavailable = client.post(
        "/v1/embeddings",
        json={"texts": ["hello"], "provider": "openai", "model": "text-embedding-3-small"},
    )
    assert unavailable.status_code == 422


def test_openai_embedding_adapter_contract() -> None:
    class FakeEmbeddings:
        async def create(self, **kwargs: object) -> object:
            assert kwargs["model"] == "text-embedding-3-small"
            assert kwargs["input"] == ["one", "two"]
            return SimpleNamespace(
                data=[
                    SimpleNamespace(index=1, embedding=[0.0, 1.0]),
                    SimpleNamespace(index=0, embedding=[1.0, 0.0]),
                ],
                model="text-embedding-3-small",
                usage=SimpleNamespace(prompt_tokens=2),
            )

    provider = OpenAIProvider("sk-test", "gpt-test", "text-embedding-3-small")
    cast(Any, provider)._client = SimpleNamespace(embeddings=FakeEmbeddings())
    result = asyncio.run(provider.embed_texts(["one", "two"], "configured-default"))
    assert result.provider == "openai"
    assert result.model == "text-embedding-3-small"
    assert result.dimensions == 2
    assert result.vectors == [[1.0, 0.0], [0.0, 1.0]]
    assert result.input_tokens == 2
