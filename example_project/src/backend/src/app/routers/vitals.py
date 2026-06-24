"""Web Vitals ingestion endpoint for frontend RUM."""

from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.observability import get_logger

router = APIRouter(prefix="/vitals", tags=["vitals"])


class WebVitalIn(BaseModel):
    name: str
    value: float
    rating: str | None = None
    id: str
    navigation_type: str | None = Field(default=None, alias="navigationType")

    model_config = {"populate_by_name": True}


@router.post("")
def record_vital(vital: WebVitalIn) -> dict[str, bool]:
    """Receive a Web Vital metric from the frontend."""
    logger = get_logger("app.vitals")
    logger.info(
        "web_vital",
        name=vital.name,
        value=vital.value,
        rating=vital.rating,
        vital_id=vital.id,
        navigation_type=vital.navigation_type,
    )
    return {"ok": True}
