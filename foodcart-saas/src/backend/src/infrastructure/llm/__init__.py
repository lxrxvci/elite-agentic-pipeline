"""LLM provider dispatch for the Foodcart AI Website Assistant.

The assistant defaults to a deterministic local stub when no LLM is configured.
When Amazon Bedrock is enabled, requests are sent to the Bedrock Runtime API.
When ``GEMINI_API_KEY`` is present, requests are sent to the Gemini API. All
backends return structured JSON output validated against the same allowlist
guardrails applied to the stub.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from domain.entities import ContentBlock
from domain.services.foodcart import ChangePreview
from domain.services.foodcart import generate_change_preview as _stub_generate

if TYPE_CHECKING:
    from app.config import Settings


class LLMProvider:
    """Thin wrapper that selects the active LLM backend at runtime."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._backend = self._select_backend()

    def _select_backend(self) -> str:
        if self._settings.bedrock_enabled:
            return "bedrock"
        if self._settings.gemini_api_key:
            return "gemini"
        return "stub"

    def generate_change_preview(
        self,
        prompt: str,
        blocks: list[ContentBlock],
        tenant_id: uuid.UUID,
        site_id: uuid.UUID,
    ) -> ChangePreview:
        if self._backend == "bedrock":
            from infrastructure.llm.bedrock import generate_change_preview_with_bedrock

            return generate_change_preview_with_bedrock(
                prompt=prompt,
                blocks=blocks,
                tenant_id=tenant_id,
                site_id=site_id,
                region=self._settings.bedrock_region,
                model_id=self._settings.bedrock_model_id,
            )
        if self._backend == "gemini":
            from infrastructure.llm.gemini import generate_change_preview_with_gemini

            return generate_change_preview_with_gemini(
                prompt=prompt,
                blocks=blocks,
                tenant_id=tenant_id,
                site_id=site_id,
                api_key=self._settings.gemini_api_key,
                model=self._settings.gemini_model,
            )
        return _stub_generate(
            prompt=prompt,
            blocks=blocks,
            tenant_id=tenant_id,
            site_id=site_id,
        )

    @property
    def model_name(self) -> str:
        if self._backend == "bedrock":
            return self._settings.bedrock_model_id
        if self._backend == "gemini":
            return self._settings.gemini_model
        return "stub"
