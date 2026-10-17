"""Embedding provider failures never escape into imports or requests."""

import asyncio
import json

import httpx
import pytest

from app.config import Settings
from app.services.matching import embeddings


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.setattr(
        embeddings, "get_settings", lambda: Settings(_env_file=None, gemini_api_key="test-key", embedding_provider="gemini")
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
    monkeypatch.setattr(embeddings, "get_settings", lambda: Settings(_env_file=None, gemini_api_key="", embedding_provider="gemini"))
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


@pytest.fixture
def ollama(provider, monkeypatch):
    settings = Settings(
        _env_file=None, embedding_provider="ollama", gemini_api_key="must-not-send",
        ollama_embedding_url="http://localhost:11434/", ollama_embedding_model="nomic-embed-text:v1.5",
    )
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings)
    return provider


def test_ollama_request_and_model_identity(ollama):
    vectors = [[0.1] * embeddings.DIMENSIONS, [0.2] * embeddings.DIMENSIONS]
    requests = ollama(httpx.Response(200, json={"embeddings": vectors}))
    assert asyncio.run(embeddings.embed(["first", "second"])) == vectors
    assert embeddings.model_key() == "ollama:nomic-embed-text:v1.5:768"
    assert len(requests) == 1
    assert str(requests[0].url) == "http://localhost:11434/api/embed"
    assert "x-goog-api-key" not in requests[0].headers
    assert json.loads(requests[0].content) == {
        "model": "nomic-embed-text:v1.5", "input": ["first", "second"], "truncate": True,
    }


@pytest.mark.parametrize("payload", [
    None, {}, {"embeddings": []}, {"embeddings": [[0.1] * 384]},
    {"embeddings": [[0.1] * 768] * 2}, {"embeddings": [{"values": [0.1] * 768}]},
    {"embeddings": [[True] * 768]}, {"embeddings": [[float("nan")] * 768]},
])
def test_ollama_invalid_vectors_are_rejected(ollama, payload):
    requests = ollama(httpx.Response(200, content=json.dumps(payload)))
    assert asyncio.run(embeddings.embed(["job"])) is None
    assert len(requests) == 1


@pytest.mark.parametrize("status", [404, 429, 500])
def test_ollama_failure_never_falls_back_to_gemini(ollama, status):
    requests = ollama(httpx.Response(status))
    assert asyncio.run(embeddings.embed(["job"])) is None
    assert len(requests) == 1
    assert requests[0].url.host == "localhost"


def test_ollama_unavailable(ollama):
    requests = ollama(error=httpx.ConnectError("offline"))
    assert asyncio.run(embeddings.embed(["job"])) is None
    assert len(requests) == 1


def test_model_keys_differ_between_providers_and_models(monkeypatch):
    settings = Settings(_env_file=None, embedding_provider="gemini")
    monkeypatch.setattr(embeddings, "get_settings", lambda: settings)
    assert embeddings.model_key() == "gemini:gemini-embedding-001:768"
    settings.embedding_provider = "ollama"
    first = embeddings.model_key()
    settings.ollama_embedding_model = "another-model"
    assert embeddings.model_key() != first


def test_provider_is_validated():
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        Settings(_env_file=None, embedding_provider="typo")


# A description as the scraper stores it since KAN-229: the kept sections under
# fixed headings (scraper/workit_scraper/sections.py, KEPT).
STORED = """Figure is an AI robotics company building humanoid robots.
Overview
Join the firmware team.
Responsibilities
Write motor control firmware in C.
Requirements
Studying computer engineering.
Preferred Qualifications
Experience with battery management systems.
Pay
$40-$50 per hour.
Details
Onsite in San Jose, CA."""


def test_job_text_reads_the_role_and_what_it_asks_for():
    text = embeddings.job_text("Firmware Engineering Intern", STORED)

    assert text == (
        "Firmware Engineering Intern\n\n"
        "Join the firmware team.\n"
        "Write motor control firmware in C.\n"
        "Studying computer engineering.\n"
        "Experience with battery management systems."
    )


def test_job_text_leaves_out_the_intro_pay_and_details():
    text = embeddings.job_text("Firmware Engineering Intern", STORED)

    assert "humanoid" not in text
    assert "$40" not in text
    assert "San Jose" not in text


def test_job_text_reads_a_description_without_the_headings_whole():
    # Stored before KAN-229, or kept whole by the scraper.
    old = "About Us\nWe build robots.\nWhat you'll do\nWrite firmware."

    assert embeddings.job_text("Intern", old) == f"Intern\n\n{old}"


def test_job_text_with_only_pay_and_details_reads_the_description_whole():
    stored = "Pay\n$40 per hour.\nDetails\nOnsite."

    assert embeddings.job_text("Intern", stored) == f"Intern\n\n{stored}"


def test_job_text_without_a_description_is_the_title():
    assert embeddings.job_text("Intern", None) == "Intern"
    assert embeddings.job_text("Intern", "") == "Intern"
