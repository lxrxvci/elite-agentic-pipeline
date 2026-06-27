"""Vision analysis adapter using Google Gemini multimodal input.

Extracts business identity signals from a food-cart photo so the onboarding
pipeline can search for the business and pre-fill the generated site.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import httpx
from pydantic import BaseModel, Field, field_validator

from app.config import settings
from app.observability import get_logger

logger = get_logger(__name__)

_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
_DEFAULT_MODEL = "gemini-2.0-flash"
_TIMEOUT_SECONDS = 30.0


class VisionExtraction(BaseModel):
    """Structured output from analyzing a food-cart photo."""

    business_name: str | None = None
    cuisine_type: str | None = None
    visible_text: list[str] = Field(default_factory=list)
    location_hints: list[str] = Field(default_factory=list)
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    has_signage: bool = False

    @field_validator("visible_text", "location_hints", mode="before")
    @classmethod
    def _ensure_list(cls, v: Any) -> list[str]:
        if v is None:
            return []
        if isinstance(v, str):
            return [v]
        return [str(item) for item in v]


_VISION_PROMPT = """Analyze this photo of a food cart, food truck, or small restaurant.

Extract the following information and return ONLY a JSON object matching this schema:
{
  "business_name": "the business name visible on signage or wrapping, or null if not readable",
  "cuisine_type": "type of cuisine if inferable from signage, menu, or visuals, or null",
  "visible_text": ["list", "of", "readable", "words", "or", "phrases"],
  "location_hints": ["city", "neighborhood", "landmark", or other location clues],
  "confidence": 0.0 to 1.0,
  "has_signage": true or false
}

Rules:
- Do not guess business details that are not visible or strongly implied.
- If no name is readable, set business_name to null and has_signage to false.
- Keep visible_text to the actual words seen in the image.
- Confidence should reflect how certain you are about the business_name.
"""


def _build_vision_request(base64_image: str, mime_type: str) -> dict[str, Any]:
    return {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"text": _VISION_PROMPT},
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": base64_image,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.1,
            "maxOutputTokens": 1024,
        },
    }


def _parse_vision_response(payload: dict[str, Any]) -> VisionExtraction:
    candidates = payload.get("candidates", [])
    if not candidates:
        raise ValueError("Gemini vision response contained no candidates")
    content = candidates[0].get("content", {})
    parts = content.get("parts", [])
    if not parts:
        raise ValueError("Gemini vision response candidate had no content parts")

    raw_text = parts[0].get("text", "")
    if not raw_text:
        raise ValueError("Gemini vision response part was empty")

    parsed = json.loads(raw_text)
    return VisionExtraction(**parsed)


def analyze_image(
    image_bytes: bytes,
    mime_type: str = "image/jpeg",
    api_key: str | None = None,
    model: str = _DEFAULT_MODEL,
) -> VisionExtraction:
    """Analyze a food-cart image and return structured extraction.

    Falls back to an empty extraction if Gemini is not configured or the call
    fails, so onboarding can continue with manual entry.
    """
    key = api_key or settings.gemini_api_key
    if not key:
        logger.warning("gemini_vision_no_api_key")
        return VisionExtraction()

    encoded = base64.b64encode(image_bytes).decode("utf-8")
    url = f"{_GEMINI_BASE_URL}/models/{model}:generateContent?key={key}"
    body = _build_vision_request(encoded, mime_type)

    try:
        with httpx.Client(timeout=_TIMEOUT_SECONDS, follow_redirects=False) as client:
            response = client.post(url, json=body)
            response.raise_for_status()
            return _parse_vision_response(response.json())
    except Exception as exc:
        logger.warning(
            "gemini_vision_failed",
            error_type=type(exc).__name__,
            model=model,
        )
        return VisionExtraction()
