"""Tests for the Gemini vision adapter used in photo-driven onboarding."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from app.config import settings
from infrastructure.llm.vision import VisionExtraction, analyze_image


class TestAnalyzeImage:
    def _vision_response(self, text: str) -> dict:
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

    def test_returns_empty_extraction_when_no_api_key(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "")
        result = analyze_image(b"fake-image-bytes")
        assert result == VisionExtraction()

    def test_returns_parsed_extraction(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")
        response_text = (
            '{"business_name": "Taco Fiesta", "cuisine_type": "Mexican", '
            '"visible_text": ["TACO", "FIESTA"], "location_hints": ["Austin, TX"], '
            '"confidence": 0.92, "has_signage": true}'
        )

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = self._vision_response(response_text)
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.vision.httpx.Client", return_value=mock_client):
            result = analyze_image(b"fake-image-bytes", mime_type="image/png")

        assert result.business_name == "Taco Fiesta"
        assert result.cuisine_type == "Mexican"
        assert result.visible_text == ["TACO", "FIESTA"]
        assert result.location_hints == ["Austin, TX"]
        assert result.confidence == pytest.approx(0.92)
        assert result.has_signage is True

    def test_request_includes_inline_image_data(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")

        captured = {}

        def capture_post(url, *, json=None, **kwargs):
            captured["url"] = url
            captured["body"] = json
            mock_response = MagicMock()
            mock_response.json.return_value = self._vision_response(
                '{"business_name": null, "confidence": 0.0}'
            )
            mock_response.raise_for_status.return_value = None
            return mock_response

        mock_client = MagicMock()
        mock_client.__enter__.return_value.post = capture_post
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.vision.httpx.Client", return_value=mock_client):
            analyze_image(b"bytes", mime_type="image/webp")

        assert "gemini-2.0-flash" in captured["url"]
        assert "fake-key" in captured["url"]
        parts = captured["body"]["contents"][0]["parts"]
        assert any(
            "inlineData" in part and part["inlineData"]["mimeType"] == "image/webp"
            for part in parts
        )
        assert captured["body"]["generationConfig"]["responseMimeType"] == "application/json"

    def test_malformed_json_falls_back_to_empty(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = self._vision_response("not-json")
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.vision.httpx.Client", return_value=mock_client):
            result = analyze_image(b"fake-image-bytes")

        assert result == VisionExtraction()

    def test_http_error_falls_back_to_empty(self, monkeypatch):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")

        mock_client = MagicMock()
        mock_client.__enter__.return_value.post.side_effect = Exception("API error")
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.vision.httpx.Client", return_value=mock_client):
            result = analyze_image(b"fake-image-bytes")

        assert result == VisionExtraction()

    @pytest.mark.parametrize(
        "bad_response",
        [
            {"candidates": []},
            {"candidates": [{"content": {"parts": []}}]},
            {"candidates": [{"content": {"parts": [{"text": ""}]}}]},
        ],
    )
    def test_empty_response_falls_back_to_empty(self, monkeypatch, bad_response):
        monkeypatch.setattr(settings, "gemini_api_key", "fake-key")

        mock_client = MagicMock()
        mock_response = MagicMock()
        mock_response.json.return_value = bad_response
        mock_response.raise_for_status.return_value = None
        mock_client.__enter__.return_value.post.return_value = mock_response
        mock_client.__exit__.return_value = False

        with patch("infrastructure.llm.vision.httpx.Client", return_value=mock_client):
            result = analyze_image(b"fake-image-bytes")

        assert result == VisionExtraction()


class TestVisionExtraction:
    def test_string_location_hints_coerced_to_list(self):
        extraction = VisionExtraction(location_hints="Austin")
        assert extraction.location_hints == ["Austin"]

    def test_none_visible_text_defaults_to_empty_list(self):
        extraction = VisionExtraction(visible_text=None)
        assert extraction.visible_text == []
