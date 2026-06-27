"""Tests for the Amazon Bedrock LLM adapter and provider dispatch."""

from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from domain.services.foodcart import default_blocks_for_template
from infrastructure.llm import LLMProvider


def _make_blocks():
    return default_blocks_for_template("banhmi", "Banh Mi Fusion", uuid.uuid4(), uuid.uuid4())


class _MockBody:
    def __init__(self, payload: dict) -> None:
        self._data = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._data


def _bedrock_response(text: str) -> dict:
    return {
        "id": "msg-123",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": text}],
        "model": "anthropic.claude-3-5-sonnet-20241022-v2:0",
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 100, "output_tokens": 50},
    }


class TestLLMProviderBedrockDispatch:
    def test_uses_stub_without_bedrock_or_gemini(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", False)
        monkeypatch.setattr(settings, "gemini_api_key", "")
        provider = LLMProvider(settings)
        assert provider.model_name == "stub"

    def test_uses_bedrock_when_enabled(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", True)
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        assert provider.model_name == settings.bedrock_model_id

    def test_uses_gemini_when_bedrock_disabled_but_key_present(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", False)
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        assert provider.model_name == settings.gemini_model


class TestBedrockAdapter:
    def test_bedrock_returns_valid_preview(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", True)
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        response_text = (
            '{"summary": "Updated story text", "in_scope": true, '
            '"confidence": 0.95, "operations": [ '
            '{"op": "replace", "path": "/blocks/story/data/body", "value": "I love cooking"}'
            ']}'
        )

        mock_client = MagicMock()
        mock_client.invoke_model.return_value = {
            "body": _MockBody(_bedrock_response(response_text))
        }

        with patch("infrastructure.llm.bedrock.boto3.client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Update the about us section to say I love cooking",
                blocks,
                uuid.uuid4(),
                uuid.uuid4(),
            )

        assert preview.in_scope is True
        assert len(preview.operations) == 1
        assert preview.operations[0].path == "/blocks/story/data/body"
        assert preview.operations[0].value == "I love cooking"

    def test_bedrock_malformed_response_falls_back_to_stub(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", True)
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        mock_client = MagicMock()
        mock_client.invoke_model.return_value = {
            "body": _MockBody(_bedrock_response("not-json"))
        }

        with patch("infrastructure.llm.bedrock.boto3.client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Update the about us section to say I love cooking",
                blocks,
                uuid.uuid4(),
                uuid.uuid4(),
            )

        assert preview.in_scope is True
        assert any(op.path == "/blocks/story/data/body" for op in preview.operations)

    def test_bedrock_api_error_falls_back_to_stub(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", True)
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        mock_client = MagicMock()
        mock_client.invoke_model.side_effect = Exception("Bedrock error")

        with patch("infrastructure.llm.bedrock.boto3.client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Update the about us section to say I love cooking",
                blocks,
                uuid.uuid4(),
                uuid.uuid4(),
            )

        assert preview.in_scope is True
        assert any(op.path == "/blocks/story/data/body" for op in preview.operations)

    @pytest.mark.parametrize(
        "bad_response",
        [
            {"content": []},
            {"content": [{"type": "text", "text": ""}]},
            {"content": [{"type": "image"}]},
        ],
    )
    def test_bedrock_empty_response_falls_back_to_stub(self, monkeypatch, bad_response):
        monkeypatch.setattr(settings, "bedrock_enabled", True)
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        mock_client = MagicMock()
        mock_client.invoke_model.return_value = {"body": _MockBody(bad_response)}

        with patch("infrastructure.llm.bedrock.boto3.client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Update the about us section to say I love cooking",
                blocks,
                uuid.uuid4(),
                uuid.uuid4(),
            )

        assert preview.in_scope is True
        assert any(op.path == "/blocks/story/data/body" for op in preview.operations)

    def test_bedrock_out_of_scope_response(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", True)
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        response_text = (
            '{"summary": "Cannot change billing", "in_scope": false, '
            '"confidence": 0.0, "operations": []}'
        )

        mock_client = MagicMock()
        mock_client.invoke_model.return_value = {
            "body": _MockBody(_bedrock_response(response_text))
        }

        with patch("infrastructure.llm.bedrock.boto3.client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Change my billing email", blocks, uuid.uuid4(), uuid.uuid4()
            )

        assert preview.in_scope is False
        assert preview.operations == []


class TestBedrockRequestBody:
    def test_request_includes_system_prompt_and_model_id(self, monkeypatch):
        monkeypatch.setattr(settings, "bedrock_enabled", True)
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        captured = {}

        def capture_invoke_model(*, modelId, body, contentType, accept):  # noqa: N803
            captured["model_id"] = modelId
            captured["body"] = json.loads(body)
            return {
                "body": _MockBody(
                    _bedrock_response(
                        '{"summary": "x", "in_scope": true, '
                        '"confidence": 0.9, "operations": []}'
                    )
                )
            }

        mock_client = MagicMock()
        mock_client.invoke_model = capture_invoke_model

        with patch("infrastructure.llm.bedrock.boto3.client", return_value=mock_client):
            provider.generate_change_preview(
                "Update the about us section to say I love cooking",
                blocks,
                uuid.uuid4(),
                uuid.uuid4(),
            )

        assert captured["model_id"] == settings.bedrock_model_id
        assert captured["body"]["anthropic_version"] == "bedrock-2023-05-31"
        assert captured["body"]["messages"][0]["role"] == "user"
        assert "I love cooking" in captured["body"]["messages"][0]["content"]
        assert "AI Website Assistant" in captured["body"]["system"]
