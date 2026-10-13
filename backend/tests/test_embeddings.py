"""Embedding provider failures never escape into imports or requests."""

import asyncio
import json
from types import SimpleNamespace

import httpx
import pytest

from app.services.matching import embeddings


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(
        embeddings, "get_settings", lambda: SimpleNamespace(gemini_api_key="test-key")
    )
    client_type = httpx.AsyncClient
    requests = []

    def install(response=None, error=None):
        def handle(request):
            requests.append(request)
            if error is not None:
                raise error
            return response

        transport = httpx.MockTransport(handle)
        monkeypatch.setattr(
            embeddings.httpx,
            "AsyncClient",
            lambda **kwargs: client_type(transport=transport, **kwargs),
        )
        return requests

    return install


def test_success_preserves_order_and_request_contract(provider):
    vectors = [[1] * embeddings.DIMENSIONS, [0.5] * embeddings.DIMENSIONS]
    requests = provider(httpx.Response(200, json={
        "embeddings": [{"values": vector} for vector in vectors]
    }))
    assert asyncio.run(embeddings.embed(["a" * 7000, "second"])) == vectors
    assert len(requests) == 1
    request = requests[0]
    assert request.headers["x-goog-api-key"] == "test-key"
    assert "test-key" not in str(request.url)
    body = json.loads(request.content)
    assert [item["content"]["parts"][0]["text"] for item in body["requests"]] == [
        "a" * 6000, "second"
    ]
    assert all(item["outputDimensionality"] == embeddings.DIMENSIONS for item in body["requests"])


@pytest.mark.parametrize("payload", [
    None, [], {}, {"embeddings": None}, {"embeddings": {}},
    {"embeddings": []},
    {"embeddings": [{"values": [0.1] * embeddings.DIMENSIONS}] * 2},
    {"embeddings": [None]}, {"embeddings": [{}]},
    {"embeddings": [{"values": None}]},
    {"embeddings": [{"values": "not a vector"}]},
    {"embeddings": [{"values": [0.1] * (embeddings.DIMENSIONS - 1)}]},
    {"embeddings": [{"values": [0.1] * (embeddings.DIMENSIONS + 1)}]},
])
def test_malformed_response_returns_none(provider, payload):
    provider(httpx.Response(200, content=json.dumps(payload)))
    assert asyncio.run(embeddings.embed(["job"])) is None


@pytest.mark.parametrize("value", [
    True, None, "0.1", {}, [], float("nan"), float("inf"), -float("inf"), 10**1000
])
def test_invalid_vector_component_returns_none(provider, value):
    vector = [0.1] * embeddings.DIMENSIONS
    vector[0] = value
    # Raw JSON permits testing non-finite values rejected by httpx's encoder.
    provider(httpx.Response(200, content=json.dumps({"embeddings": [{"values": vector}]})))
    assert asyncio.run(embeddings.embed(["job"])) is None


def test_invalid_json_returns_none(provider):
    provider(httpx.Response(200, content="not JSON"))
    assert asyncio.run(embeddings.embed(["job"])) is None


@pytest.mark.parametrize("status", [400, 429, 500])
def test_http_failure_returns_none(provider, status):
    provider(httpx.Response(status, text="provider failed"))
    assert asyncio.run(embeddings.embed(["job"])) is None


@pytest.mark.parametrize("error", [httpx.ConnectError("offline"), httpx.ReadTimeout("timeout")])
def test_transport_failure_returns_none(provider, error):
    provider(error=error)
    assert asyncio.run(embeddings.embed(["job"])) is None


def test_no_key_skips_http(provider, monkeypatch):
    requests = provider()
    monkeypatch.setattr(embeddings, "get_settings", lambda: SimpleNamespace(gemini_api_key=""))
    assert asyncio.run(embeddings.embed(["job"])) is None
    assert requests == []


def test_empty_batch_is_empty_without_http_or_settings(provider, monkeypatch):
    requests = provider()
    monkeypatch.setattr(embeddings, "get_settings", lambda: pytest.fail("settings accessed"))
    assert asyncio.run(embeddings.embed([])) == []
    assert requests == []


def test_oversized_batch_is_programmer_error_without_http(provider):
    requests = provider()
    with pytest.raises(ValueError, match="at most"):
        asyncio.run(embeddings.embed(["job"] * (embeddings.BATCH_SIZE + 1)))
    assert requests == []
