"""Frontend telemetry event ingestion endpoint."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel, Field, field_validator

from app.limiter import limiter
from app.observability import get_logger, get_metrics_provider

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


class TelemetryEvent(BaseModel):
    """A single telemetry event sent by the frontend RUM helper."""

    event: str = Field(
        ...,
        min_length=1,
        max_length=64,
        description="Telemetry event name (e.g. photo_upload_succeeded).",
    )
    payload: dict[str, Any] | None = Field(
        default=None,
        description="Arbitrary, non-sensitive payload attached to the event.",
    )
    timestamp: str | None = Field(
        default=None,
        description="ISO-8601 timestamp from the client.",
    )

    @field_validator("event")
    @classmethod
    def _validate_event_name(cls, value: str) -> str:
        allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.-")
        if not all(char in allowed for char in value):
            msg = "event name must contain only alphanumeric, underscore, dot, or hyphen characters"
            raise ValueError(msg)
        return value


@router.post("", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("100/minute")
def record_telemetry(request: Request, event: TelemetryEvent) -> Response:
    """Receive a telemetry event from the frontend.

    The endpoint is intentionally lightweight and unauthenticated so that RUM
    events from anonymous or pre-auth pages can be recorded. It logs a
    structured entry and increments `elite_telemetry_events_total`.
    """
    logger = get_logger("app.telemetry")
    logger.info(
        "telemetry_event_received",
        event_name=event.event,
        timestamp=event.timestamp,
        payload=event.payload,
    )

    metrics = get_metrics_provider()
    metrics.observe_telemetry(event=event.event)

    return Response(status_code=status.HTTP_204_NO_CONTENT)
