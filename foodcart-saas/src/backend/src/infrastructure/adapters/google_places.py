"""Google Places API adapter for business enrichment."""

from __future__ import annotations

import re
import time
from typing import Any

import httpx
from opentelemetry import trace
from pydantic import BaseModel, Field

from app.config import settings
from app.observability import get_logger, get_metrics_provider

logger = get_logger(__name__)
tracer = trace.get_tracer(__name__)

_PLACES_BASE_URL = "https://places.googleapis.com/v1"
_TIMEOUT_SECONDS = 15.0

_DEFAULT_FIELDS = [
    "id",
    "displayName",
    "formattedAddress",
    "internationalPhoneNumber",
    "websiteUri",
    "googleMapsUri",
    "regularOpeningHours",
    "photos",
]


class PlaceDetails(BaseModel):
    """Normalized result from Google Places API."""

    place_id: str = ""
    name: str = ""
    address: str = ""
    phone: str = ""
    website: str = ""
    google_maps_url: str = ""
    hours: dict[str, str] = Field(default_factory=dict)
    photo_references: list[str] = Field(default_factory=list)


def _headers(api_key: str | None = None) -> dict[str, str]:
    key = api_key or settings.google_places_api_key
    return {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
    }


_TIME_RE = re.compile(
    r"^\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)\s*[-–—]\s*(\d{1,2}):?(\d{2})?\s*(AM|PM)\s*$",
    re.IGNORECASE,
)


def _parse_am_pm_time(hour: int, minute: int | None, meridiem: str) -> str:
    """Return a 24-hour 'HH:MM' string from parsed 12-hour components."""
    minute = minute or 0
    if meridiem.upper() == "PM" and hour != 12:
        hour += 12
    elif meridiem.upper() == "AM" and hour == 12:
        hour = 0
    return f"{hour:02d}:{minute:02d}"


def _normalize_time_range(time_range: str) -> str | None:
    """Convert '9:00 AM – 10:00 PM' to '09:00-22:00'."""
    match = _TIME_RE.match(time_range)
    if not match:
        return None
    start_hour, start_minute, start_meridiem, end_hour, end_minute, end_meridiem = (
        match.groups()
    )
    start = _parse_am_pm_time(
        int(start_hour), int(start_minute) if start_minute else None, start_meridiem
    )
    end = _parse_am_pm_time(
        int(end_hour), int(end_minute) if end_minute else None, end_meridiem
    )
    return f"{start}-{end}"


def _parse_weekday_text(weekday_text: list[str] | None) -> dict[str, str]:
    """Convert Google weekday text like 'Monday: 9:00 AM – 10:00 PM' to interval."""
    if not weekday_text:
        return {}

    day_map = {
        "monday": "monday",
        "tuesday": "tuesday",
        "wednesday": "wednesday",
        "thursday": "thursday",
        "friday": "friday",
        "saturday": "saturday",
        "sunday": "sunday",
    }
    hours: dict[str, str] = {}
    for entry in weekday_text:
        if ":" not in entry:
            continue
        day_part, time_part = entry.split(":", 1)
        day = day_map.get(day_part.strip().lower())
        if not day:
            continue
        time_part = time_part.strip()
        if time_part.lower() in {"closed", ""}:
            continue
        normalized = _normalize_time_range(time_part)
        if normalized:
            hours[day] = normalized
    return hours


def _parse_place(place: dict[str, Any]) -> PlaceDetails:
    regular_hours = place.get("regularOpeningHours") or {}
    weekday_text = regular_hours.get("weekdayDescriptions") or []
    photos = place.get("photos") or []
    return PlaceDetails(
        place_id=place.get("id", ""),
        name=place.get("displayName", {}).get("text", ""),
        address=place.get("formattedAddress", ""),
        phone=place.get("internationalPhoneNumber", ""),
        website=place.get("websiteUri", ""),
        google_maps_url=place.get("googleMapsUri", ""),
        hours=_parse_weekday_text(weekday_text),
        photo_references=[p.get("name", "") for p in photos if p.get("name")],
    )


def search_places(
    query: str,
    location_bias: str | None = None,
    api_key: str | None = None,
) -> list[PlaceDetails]:
    """Search Google Places by text query and return top results."""
    key = api_key or settings.google_places_api_key
    if not key:
        logger.warning("google_places_no_api_key", query=query)
        return []

    with tracer.start_as_current_span("places.search_places") as span:
        span.set_attribute("query", query)
        span.set_attribute("has_location_bias", location_bias is not None)

        url = f"{_PLACES_BASE_URL}/places:searchText"
        body: dict[str, Any] = {"textQuery": query}
        if location_bias:
            body["locationBias"] = {"text": location_bias}

        params = {
            "fields": ",".join(_DEFAULT_FIELDS),
        }

        try:
            with httpx.Client(timeout=_TIMEOUT_SECONDS, follow_redirects=False) as client:
                response = client.post(
                    url,
                    params=params,
                    json=body,
                    headers=_headers(key),
                )
                response.raise_for_status()
                data = response.json()
                places = data.get("places", [])
                span.set_attribute("result_count", len(places))
                return [_parse_place(p) for p in places]
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
            logger.warning(
                "google_places_search_failed",
                error_type=type(exc).__name__,
                query=query,
            )
            return []


def get_place_details(
    place_id: str,
    api_key: str | None = None,
) -> PlaceDetails | None:
    """Fetch details for a specific Google Place ID."""
    key = api_key or settings.google_places_api_key
    if not key:
        logger.warning("google_places_no_api_key", place_id=place_id)
        return None

    with tracer.start_as_current_span("places.get_place_details") as span:
        span.set_attribute("place_id", place_id)

        url = f"{_PLACES_BASE_URL}/places/{place_id}"
        params = {
            "fields": ",".join(_DEFAULT_FIELDS),
        }

        try:
            with httpx.Client(timeout=_TIMEOUT_SECONDS, follow_redirects=False) as client:
                response = client.get(url, params=params, headers=_headers(key))
                response.raise_for_status()
                result = _parse_place(response.json())
                span.set_attribute("place_name", result.name)
                return result
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
            logger.warning(
                "google_places_details_failed",
                error_type=type(exc).__name__,
                place_id=place_id,
            )
            return None


def find_business(
    name: str,
    location_hints: list[str] | None = None,
    api_key: str | None = None,
) -> PlaceDetails | None:
    """Find the best-matching place for a business name + optional location."""
    metrics = get_metrics_provider()
    query = name
    location_bias = ", ".join(location_hints) if location_hints else None
    start = time.perf_counter()

    try:
        results = search_places(query=query, location_bias=location_bias, api_key=api_key)
        if not results:
            return None
        # Prefer result whose name contains the queried name (case-insensitive).
        lowered_name = name.lower()
        for result in results:
            if lowered_name in result.name.lower() or result.name.lower() in lowered_name:
                return result
        return results[0]
    finally:
        duration = time.perf_counter() - start
        metrics.observe_photo_places_duration(duration)
