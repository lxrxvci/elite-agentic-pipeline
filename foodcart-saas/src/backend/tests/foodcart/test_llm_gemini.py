"""Tests for the Gemini LLM adapter and provider dispatch."""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from domain.services.foodcart import default_blocks_for_template
from infrastructure.llm import LLMProvider


def _make_blocks():
    return default_blocks_for_template("banhmi", "Banh Mi Fusion", uuid.uuid4(), uuid.uuid4())


class TestLLMProviderDispatch:
    def test_uses_stub_without_api_key(self):
        provider = LLMProvider(settings)
        assert provider.model_name == "stub"

    def test_stub_backend_generates_preview(self):
        provider = LLMProvider(settings)
        blocks = _make_blocks()
        preview = provider.generate_change_preview(
            "Change hero headline to Stub Works", blocks, uuid.uuid4(), uuid.uuid4()
        )
        assert preview.in_scope is True
        assert any(op.path == "/blocks/hero/data/headline" for op in preview.operations)

    def test_uses_gemini_with_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        monkeypatch.setattr(settings, "gemini_model", "gemini-2.0-flash")
        provider = LLMProvider(settings)
        assert provider.model_name == "gemini-2.0-flash"


class TestGeminiAdapter:
    def _gemini_response(self, text: str):
        return {
            "candidates": [
                {
                    "content": {
                        "parts": [{"text": text}],
                        "role": "model",
                    }
                }
            ]
        }

    def test_gemini_returns_valid_preview(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        response_text = (
            '{"summary": "Updated hero headline", "in_scope": true, '
            '"confidence": 0.95, "operations": ['
            '{"op": "replace", "path": "/blocks/hero/data/headline", "value": "Summer Specials"}'
            ']}'
        )

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = self._gemini_response(response_text)
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.gemini.httpx.Client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Change hero headline to Summer Specials", blocks, uuid.uuid4(), uuid.uuid4()
            )

        assert preview.in_scope is True
        assert preview.operations[0].path == "/blocks/hero/data/headline"
        assert preview.operations[0].value == "Summer Specials"

    def test_gemini_malformed_response_falls_back_to_stub(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = self._gemini_response("not-json")
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.gemini.httpx.Client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Change hero headline to Fallback", blocks, uuid.uuid4(), uuid.uuid4()
            )

        assert preview.in_scope is True
        assert any(op.path == "/blocks/hero/data/headline" for op in preview.operations)

    def test_gemini_http_error_falls_back_to_stub(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        mock_client = MagicMock()
        mock_client.__enter__.return_value.post.side_effect = Exception("API error")
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.gemini.httpx.Client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Change hero headline to Fallback", blocks, uuid.uuid4(), uuid.uuid4()
            )

        assert preview.in_scope is True
        assert any(op.path == "/blocks/hero/data/headline" for op in preview.operations)

    @pytest.mark.parametrize(
        "bad_response",
        [
            {"candidates": []},
            {"candidates": [{"content": {"parts": []}}]},
            {"candidates": [{"content": {"parts": [{"text": ""}]}}]},
        ],
    )
    def test_gemini_empty_response_falls_back_to_stub(self, monkeypatch, bad_response):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = bad_response
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.gemini.httpx.Client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Change hero headline to Fallback", blocks, uuid.uuid4(), uuid.uuid4()
            )

        assert preview.in_scope is True
        assert any(op.path == "/blocks/hero/data/headline" for op in preview.operations)

    def test_gemini_out_of_scope_response(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        response_text = (
            '{"summary": "Cannot change billing", "in_scope": false, '
            '"confidence": 0.0, "operations": []}'
        )

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = self._gemini_response(response_text)
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.gemini.httpx.Client", return_value=mock_client):
            preview = provider.generate_change_preview(
                "Change my billing email", blocks, uuid.uuid4(), uuid.uuid4()
            )

        assert preview.in_scope is False
        assert preview.operations == []


class TestGeminiRequestBody:
    def test_request_includes_system_prompt_and_json_mode(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        provider = LLMProvider(settings)
        blocks = _make_blocks()

        captured = {}

        def capture_post(url, *, json=None, **kwargs):
            captured["url"] = url
            captured["body"] = json
            mock_response = MagicMock()
            mock_response.json.return_value = {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        '{"summary": "x", "in_scope": true, '
                                        '"confidence": 0.9, "operations": []}'
                                    )
                                }
                            ]
                        }
                    }
                ]
            }
            mock_response.raise_for_status.return_value = None
            return mock_response

        mock_client = MagicMock()
        mock_client.__enter__.return_value.post = capture_post
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.gemini.httpx.Client", return_value=mock_client):
            provider.generate_change_preview(
                "Change hero headline to Test", blocks, uuid.uuid4(), uuid.uuid4()
            )

        assert "gemini-2.0-flash" in captured["url"]
        assert "fake-key" in captured["url"]
        assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"
        assert any(
            "AI Website Assistant" in part["text"]
            for part in captured["body"]["systemInstruction"]["parts"]
        )
