"""Foodcart SaaS domain services (framework-independent logic)."""

from __future__ import annotations

import hashlib
import hmac
import ipaddress
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Any
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, available_timezones

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator

from domain.entities import (
    ContentBlock,
    ContentBlockType,
    FoodcartBillingStatus,
    FoodcartTenant,
    FoodcartTenantStatus,
    IngestionJob,
    IngestionJobStatus,
    IngestionSourceType,
    Site,
    SitePublishState,
)

# ---------------------------------------------------------------------------
# Slug utilities
# ---------------------------------------------------------------------------

RESERVED_SLUGS = {
    "admin",
    "api",
    "app",
    "www",
    "mail",
    "ftp",
    "localhost",
    "support",
    "help",
    "billing",
}


def normalize_slug(value: str) -> str:
    """Return a lowercase, hyphen-separated slug limited to 63 characters."""
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    value = re.sub(r"-+", "-", value).strip("-")
    return value[:63]


def is_valid_slug(value: str) -> bool:
    normalized = normalize_slug(value)
    if not normalized or len(normalized) > 63:
        return False
    if normalized in RESERVED_SLUGS:
        return False
    return bool(re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", normalized))


def suggest_slugs(base: str, taken: set[str], count: int = 3) -> list[str]:
    normalized = normalize_slug(base)
    suggestions: list[str] = []
    for i in range(1, count + 1):
        candidate = f"{normalized}-{i}"
        if candidate not in taken and len(candidate) <= 63:
            suggestions.append(candidate)
    return suggestions


# ---------------------------------------------------------------------------
# Hours / open-closed logic
# ---------------------------------------------------------------------------


class OpenClosedStatus(StrEnum):
    OPEN = "open"
    CLOSED = "closed"


@dataclass(frozen=True)
class LocationStatus:
    status: OpenClosedStatus
    opens_at: str | None = None
    closes_at: str | None = None
    message: str = ""


_HOUR_RE = re.compile(r"^\s*(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})\s*$")


def _parse_interval(
    value: str, ref_local: datetime | None = None
) -> tuple[datetime, datetime] | None:
    """Parse 'HH:MM-HH:MM' into local datetimes anchored to ``ref_local``."""
    match = _HOUR_RE.match(value)
    if not match:
        return None
    sh, sm, eh, em = (int(g) for g in match.groups())
    base = ref_local or datetime.now(UTC).astimezone()
    start = base.replace(hour=sh, minute=sm, second=0, microsecond=0)
    end = base.replace(hour=eh, minute=em, second=0, microsecond=0)
    if end <= start:
        end += timedelta(days=1)
    return start, end


def _day_name(dt: datetime) -> str:
    return dt.strftime("%A").lower()


def compute_location_status(
    hours: dict[str, str],
    timezone_name: str,
    reference_time: datetime | None = None,
) -> LocationStatus:
    """Return a timezone-aware open/closed status for a single location.

    ``hours`` maps lowercase English day names (``monday`` ... ``sunday``) to
    an interval string such as ``"11:00-22:00"``. An empty or missing value
    means closed that day.
    """
    if timezone_name not in available_timezones():
        return LocationStatus(
            status=OpenClosedStatus.CLOSED,
            message="Invalid timezone",
        )

    tz = ZoneInfo(timezone_name)
    ref = reference_time or datetime.now(UTC)
    local_ref = ref.astimezone(tz)
    today_key = _day_name(local_ref)

    # Overnight hours may belong to yesterday.
    yesterday = local_ref - timedelta(days=1)
    yesterday_key = _day_name(yesterday)
    yesterday_value = hours.get(yesterday_key, "")
    if yesterday_value:
        interval = _parse_interval(yesterday_value, yesterday)
        if interval:
            start, end = interval
            if end <= start:
                end += timedelta(days=1)
            start = start.replace(tzinfo=tz)
            end = end.replace(tzinfo=tz)
            if start <= local_ref < end:
                return LocationStatus(
                    status=OpenClosedStatus.OPEN,
                    opens_at=None,
                    closes_at=end.strftime("%I:%M %p").lstrip("0"),
                    message=f"Open now until {end.strftime('%I:%M %p').lstrip('0')}",
                )

    today_value = hours.get(today_key, "")
    if not today_value:
        return LocationStatus(
            status=OpenClosedStatus.CLOSED,
            message="Closed today",
        )

    interval = _parse_interval(today_value, local_ref)
    if not interval:
        return LocationStatus(
            status=OpenClosedStatus.CLOSED,
            message="Invalid hours",
        )

    start, end = interval
    start = start.replace(tzinfo=tz)
    end = end.replace(tzinfo=tz)

    if start <= local_ref < end:
        return LocationStatus(
            status=OpenClosedStatus.OPEN,
            opens_at=None,
            closes_at=end.strftime("%I:%M %p").lstrip("0"),
            message=f"Open now until {end.strftime('%I:%M %p').lstrip('0')}",
        )

    if local_ref < start:
        opens = start.strftime("%I:%M %p").lstrip("0")
        return LocationStatus(
            status=OpenClosedStatus.CLOSED,
            opens_at=opens,
            message=f"Closed — opens today at {opens}",
        )

    # Already closed today; find next open day.
    for offset in range(1, 8):
        next_day = local_ref + timedelta(days=offset)
        key = _day_name(next_day)
        value = hours.get(key, "")
        if value:
            interval = _parse_interval(value, next_day)
            if interval:
                next_start, _ = interval
                next_start = next_start.replace(tzinfo=tz)
                opens = next_start.strftime("%I:%M %p").lstrip("0")
                day_label = next_day.strftime("%A")
                return LocationStatus(
                    status=OpenClosedStatus.CLOSED,
                    opens_at=opens,
                    message=f"Closed — opens {day_label} at {opens}",
                )

    return LocationStatus(
        status=OpenClosedStatus.CLOSED,
        message="Closed",
    )


# ---------------------------------------------------------------------------
# Content block data schemas
# ---------------------------------------------------------------------------


class HeroBlockData(BaseModel):
    headline: str = ""
    tagline: str = ""
    image_url: str | None = None
    cta_text: str = ""
    cta_url: str | None = None


class StoryBlockData(BaseModel):
    title: str = ""
    body: str = ""


class MenuItem(BaseModel):
    name: str
    description: str | None = None
    price: str | None = None
    image_url: str | None = None
    tags: list[str] = Field(default_factory=list)


class MenuCategory(BaseModel):
    title: str
    items: list[MenuItem] = Field(default_factory=list)


class MenuBlockData(BaseModel):
    categories: list[MenuCategory] = Field(default_factory=list)


class LocationData(BaseModel):
    name: str = ""
    address: str = ""
    phone: str = ""
    hours: dict[str, str] = Field(default_factory=dict)
    timezone: str = "America/New_York"
    map_url: str | None = None

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, v: str) -> str:
        if v not in available_timezones():
            raise ValueError("Invalid IANA timezone")
        return v


class LocationsBlockData(BaseModel):
    locations: list[LocationData] = Field(default_factory=list)


class CateringBlockData(BaseModel):
    title: str = ""
    body: str = ""


class ContactBlockData(BaseModel):
    phone: str = ""
    email: str | None = None
    address: str = ""


class OrderLink(BaseModel):
    platform: str
    url: str


class OrderLinksBlockData(BaseModel):
    links: list[OrderLink] = Field(default_factory=list)


class FooterBlockData(BaseModel):
    copyright: str = ""
    social_links: list[OrderLink] = Field(default_factory=list)


_BLOCK_DATA_SCHEMAS: dict[str, type[BaseModel]] = {
    ContentBlockType.HERO.value: HeroBlockData,
    ContentBlockType.STORY.value: StoryBlockData,
    ContentBlockType.MENU.value: MenuBlockData,
    ContentBlockType.LOCATIONS.value: LocationsBlockData,
    ContentBlockType.CATERING.value: CateringBlockData,
    ContentBlockType.CONTACT.value: ContactBlockData,
    ContentBlockType.ORDER_LINKS.value: OrderLinksBlockData,
    ContentBlockType.FOOTER.value: FooterBlockData,
}


def validate_block_data(block_type: str, data: dict[str, Any]) -> dict[str, Any]:
    """Validate and normalize a content block's ``data`` field."""
    schema = _BLOCK_DATA_SCHEMAS.get(block_type)
    if not schema:
        raise ValueError(f"Unknown block type: {block_type}")
    return schema(**data).model_dump()


def default_blocks_for_template(
    template_id: str,
    business_name: str,
    site_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> list[ContentBlock]:
    """Return a starter set of content blocks for a new site."""
    now = datetime.now(UTC)

    def _block(block_type: ContentBlockType, sort_order: int, data: dict[str, Any]) -> ContentBlock:
        return ContentBlock(
            id=uuid.uuid4(),
            site_id=site_id,
            tenant_id=tenant_id,
            block_type=block_type,
            schema_version="1.0",
            data=data,
            sort_order=sort_order,
            created_at=now,
            updated_at=now,
        )

    return [
        _block(
            ContentBlockType.HERO,
            0,
            {
                "headline": business_name,
                "tagline": "Fresh food, made with love.",
                "cta_text": "Order Now",
            },
        ),
        _block(
            ContentBlockType.STORY,
            1,
            {"title": "Our Story", "body": "Tell your customers what makes you special."},
        ),
        _block(
            ContentBlockType.MENU,
            2,
            {
                "categories": [
                    {
                        "title": "Signature Items",
                        "items": [
                            {
                                "name": "Sample Item",
                                "description": "A house favorite",
                                "price": "$0.00",
                            }
                        ],
                    }
                ]
            },
        ),
        _block(
            ContentBlockType.LOCATIONS,
            3,
            {
                "locations": [
                    {
                        "name": "Main Location",
                        "address": "123 Main St",
                        "phone": "",
                        "hours": {
                            "monday": "11:00-21:00",
                            "tuesday": "11:00-21:00",
                            "wednesday": "11:00-21:00",
                            "thursday": "11:00-21:00",
                            "friday": "11:00-22:00",
                            "saturday": "11:00-22:00",
                            "sunday": "12:00-20:00",
                        },
                        "timezone": "America/New_York",
                    }
                ]
            },
        ),
        _block(
            ContentBlockType.CATERING,
            4,
            {
                "title": "Catering",
                "body": "We cater events of all sizes. Get in touch for a quote.",
            },
        ),
        _block(
            ContentBlockType.CONTACT,
            5,
            {"phone": "", "email": None, "address": ""},
        ),
        _block(
            ContentBlockType.ORDER_LINKS,
            6,
            {"links": []},
        ),
        _block(
            ContentBlockType.FOOTER,
            7,
            {"copyright": f"© {datetime.now(UTC).year} {business_name}", "social_links": []},
        ),
    ]


# ---------------------------------------------------------------------------
# Ingestion adapters with SSRF protection
# ---------------------------------------------------------------------------


class URLNotAllowedError(Exception):
    pass


def _is_private_host(hostname: str) -> bool:
    """Return True if hostname resolves to a non-public IP or is localhost."""
    lowered = hostname.lower()
    if lowered in {"localhost", "127.0.0.1", "::1"}:
        return True
    try:
        ip = ipaddress.ip_address(lowered)
        return not ip.is_global
    except ValueError:
        pass
    try:
        # Best-effort DNS resolution guard; not a substitute for egress controls.
        import socket

        addr = socket.gethostbyname(lowered)
        ip = ipaddress.ip_address(addr)
        return not ip.is_global
    except Exception:
        return False


def validate_public_url(url: str) -> str:
    """Raise URLNotAllowedError for non-HTTP(S) or private/internal URLs."""
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise URLNotAllowedError("Only HTTP and HTTPS URLs are allowed")
    if not parsed.hostname:
        raise URLNotAllowedError("URL is missing a host")
    if _is_private_host(parsed.hostname):
        raise URLNotAllowedError("Private or internal hosts are not allowed")
    return url


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def _extract_title(html: str) -> str:
    match = _TITLE_RE.search(html)
    if match:
        return re.sub(r"\s+", " ", match.group(1).strip())
    return ""


def _fetch_url(url: str) -> dict[str, Any]:
    validate_public_url(url)
    try:
        with httpx.Client(timeout=10, follow_redirects=True) as client:
            response = client.get(url)
            response.raise_for_status()
            text = response.text[:100_000]
            return {"status_code": response.status_code, "text": text}
    except httpx.HTTPError as exc:
        raise RuntimeError(f"Failed to fetch {url}: {exc}") from exc


def ingest_google_business(url: str) -> dict[str, Any]:
    raw = _fetch_url(url)
    title = _extract_title(raw["text"])
    return {
        "source_type": IngestionSourceType.GOOGLE_BUSINESS.value,
        "raw_payload": raw,
        "normalized_data": {
            "name": title or "Imported Business",
            "phone": "",
            "hours": {},
            "address": "",
        },
        "proposed_blocks": [],
    }


def ingest_yelp(url: str) -> dict[str, Any]:
    raw = _fetch_url(url)
    title = _extract_title(raw["text"])
    return {
        "source_type": IngestionSourceType.YELP.value,
        "raw_payload": raw,
        "normalized_data": {
            "name": title or "Imported Business",
            "phone": "",
            "hours": {},
            "address": "",
        },
        "proposed_blocks": [],
    }


def ingest_website(url: str) -> dict[str, Any]:
    raw = _fetch_url(url)
    title = _extract_title(raw["text"])
    return {
        "source_type": IngestionSourceType.WEBSITE.value,
        "raw_payload": raw,
        "normalized_data": {
            "name": title or "Imported Website",
            "phone": "",
            "hours": {},
            "address": "",
        },
        "proposed_blocks": [],
    }


def ingest_menu_url(url: str) -> dict[str, Any]:
    raw = _fetch_url(url)
    text = raw["text"]
    snippet = re.sub(r"<[^>]+>", " ", text)[:500]
    return {
        "source_type": IngestionSourceType.MENU_URL.value,
        "raw_payload": raw,
        "normalized_data": {"menu_text_snippet": snippet},
        "proposed_blocks": [],
    }


def ingest_social_links(links: list[dict[str, str]]) -> dict[str, Any]:
    normalized: dict[str, Any] = {"social_links": [], "order_links": []}
    for link in links:
        platform = link.get("platform", "").lower()
        url = link.get("url", "")
        if platform in {"google", "yelp", "instagram", "facebook", "tiktok", "website"}:
            normalized["social_links"].append({"platform": platform, "url": url})
    return {
        "source_type": IngestionSourceType.SOCIAL_LINKS.value,
        "raw_payload": {"links": links},
        "normalized_data": normalized,
        "proposed_blocks": [],
    }


def run_ingestion_job(job: IngestionJob) -> IngestionJob:
    job.status = IngestionJobStatus.RUNNING
    try:
        if job.source_type == IngestionSourceType.GOOGLE_BUSINESS:
            result = ingest_google_business(job.source_url)
        elif job.source_type == IngestionSourceType.YELP:
            result = ingest_yelp(job.source_url)
        elif job.source_type == IngestionSourceType.WEBSITE:
            result = ingest_website(job.source_url)
        elif job.source_type == IngestionSourceType.MENU_URL:
            result = ingest_menu_url(job.source_url)
        elif job.source_type == IngestionSourceType.SOCIAL_LINKS:
            # social_links payload stored as a single URL-encoded list in raw_payload
            links = (job.raw_payload or {}).get("links", []) if job.raw_payload else []
            result = ingest_social_links(links)
        else:
            raise ValueError(f"Unsupported source type: {job.source_type}")

        job.normalized_data = result.get("normalized_data")
        job.raw_payload = result.get("raw_payload")
        job.proposed_blocks = result.get("proposed_blocks", [])
        job.status = IngestionJobStatus.COMPLETED
    except URLNotAllowedError as exc:
        job.status = IngestionJobStatus.FAILED
        job.errors.append(str(exc))
    except Exception as exc:
        job.status = IngestionJobStatus.FAILED
        job.errors.append(str(exc))
    return job


def merge_ingestion_into_blocks(
    blocks: list[ContentBlock], normalized_data: dict[str, Any]
) -> list[ContentBlock]:
    """Best-effort merge of ingestion results into starter content blocks."""
    name = normalized_data.get("name")
    phone = normalized_data.get("phone")
    address = normalized_data.get("address")
    hours = normalized_data.get("hours") or {}
    social_links = normalized_data.get("social_links", [])
    order_links = normalized_data.get("order_links", [])

    for block in blocks:
        if block.block_type == ContentBlockType.HERO and name:
            block.data["headline"] = name
        elif block.block_type == ContentBlockType.CONTACT:
            if phone:
                block.data["phone"] = phone
            if address:
                block.data["address"] = address
        elif block.block_type == ContentBlockType.LOCATIONS and hours:
            for loc in block.data.get("locations", []):
                loc["hours"] = {**loc.get("hours", {}), **hours}
        elif block.block_type == ContentBlockType.FOOTER and social_links:
            block.data["social_links"] = social_links
        elif block.block_type == ContentBlockType.ORDER_LINKS and order_links:
            block.data["links"] = order_links
    return blocks


# ---------------------------------------------------------------------------
# AI assistant transformer and patch allowlist
# ---------------------------------------------------------------------------


class PatchOperation(BaseModel):
    op: str = Field(..., pattern=r"^(add|replace|remove)$")
    path: str = Field(..., min_length=1)
    value: Any = None


class ChangePreview(BaseModel):
    model_config = ConfigDict(strict=True)

    proposal_id: uuid.UUID = Field(default_factory=uuid.uuid4)
    summary: str = ""
    in_scope: bool = True
    confidence: float = Field(0.0, ge=0.0, le=1.0)
    operations: list[PatchOperation] = Field(default_factory=list)


_PROHIBITED_KEYWORDS = {
    "delete account",
    "billing",
    "subscription",
    "payment",
    "auth",
    "password",
    "clerk",
    "slug",
    "domain",
    "tenant",
    "execute",
    "sql",
    "database",
    "code",
    "script",
    "ignore previous instructions",
}

_ALLOWED_HERO_FIELDS = {"headline", "tagline", "image_url", "cta_text", "cta_url"}
_ALLOWED_STORY_FIELDS = {"title", "body"}
_ALLOWED_CATERING_FIELDS = {"title", "body"}
_ALLOWED_CONTACT_FIELDS = {"phone", "email", "address"}
_ALLOWED_FOOTER_FIELDS = {"copyright", "social_links"}
_ALLOWED_LOCATION_FIELDS = {"name", "address", "phone", "timezone", "map_url"}
_DAYS = {
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
}


def _sanitize_prompt(prompt: str) -> str:
    # Strip control characters and collapse whitespace.
    prompt = re.sub(r"[\x00-\x08\x0b-\x0c\x0e-\x1f\x7f]", "", prompt)
    prompt = re.sub(r"\s+", " ", prompt).strip()
    return prompt


def _is_prompt_in_scope(prompt: str) -> bool:
    lowered = prompt.lower()
    for keyword in _PROHIBITED_KEYWORDS:
        if keyword in lowered:
            return False
    return True


def _find_block_index(blocks: list[ContentBlock], block_type: str) -> int:
    for i, block in enumerate(blocks):
        if block.block_type.value == block_type:
            return i
    return -1


def _hero_operation(prompt: str, blocks: list[ContentBlock]) -> PatchOperation | None:
    lowered = prompt.lower()
    if "headline" in lowered:
        value = "New Headline"
        for token in ["to ", "as ", "'", '"']:
            if token in prompt.lower():
                parts = prompt.split(token, 1)
                if len(parts) > 1 and parts[1].strip():
                    value = parts[1].strip().strip("'\".!")
                    break
        return PatchOperation(op="replace", path="/blocks/hero/data/headline", value=value)
    if "tagline" in lowered:
        return PatchOperation(
            op="replace", path="/blocks/hero/data/tagline", value="Updated tagline."
        )
    if "image" in lowered:
        return PatchOperation(
            op="replace",
            path="/blocks/hero/data/image_url",
            value="https://example.com/hero.jpg",
        )
    return PatchOperation(
        op="replace", path="/blocks/hero/data/headline", value="Updated hero headline."
    )


def _menu_operation(prompt: str, blocks: list[ContentBlock]) -> list[PatchOperation]:
    lowered = prompt.lower()
    ops: list[PatchOperation] = []
    if "vegan" in lowered or "vegetarian" in lowered:
        ops.append(
            PatchOperation(
                op="add",
                path="/blocks/menu/data/categories",
                value={"title": "Vegan", "items": []},
            )
        )
    if "add " in lowered and ("$" in prompt or "wrap" in lowered):
        # Naive item extraction: take tokens between "add" and price/end.
        item_name = "New Item"
        price = "$0.00"
        match = re.search(r"add\s+(.+?)\s+\$(\d+(?:\.\d{2})?)", lowered)
        if match:
            item_name = match.group(1).strip().title()
            price = f"${match.group(2)}"
        ops.append(
            PatchOperation(
                op="add",
                path="/blocks/menu/data/categories/0/items/-",
                value={"name": item_name, "description": "", "price": price},
            )
        )
    if not ops:
        ops.append(
            PatchOperation(
                op="replace",
                path="/blocks/menu/data/categories/0/title",
                value="Signature Items",
            )
        )
    return ops


def _hours_operation(prompt: str, blocks: list[ContentBlock]) -> PatchOperation | None:
    lowered = prompt.lower()
    day = None
    for d in _DAYS:
        if d in lowered:
            day = d
            break
    if not day:
        return None
    # Extract a time interval using a simple regex.
    match = re.search(r"(\d{1,2}(?::\d{2})?\s*(?:am|pm))", lowered, re.IGNORECASE)
    closing = "23:00"
    if match:
        closing = _normalize_time(match.group(1))
    return PatchOperation(
        op="replace",
        path=f"/blocks/locations/data/locations/0/hours/{day}",
        value=f"11:00-{closing}",
    )


def _normalize_time(value: str) -> str:
    value = value.strip().lower().replace(" ", "")
    match = re.match(r"(\d{1,2}):(\d{2})(am|pm)", value)
    if match:
        hour, minute, meridiem = match.groups()
        hour = int(hour)
        minute = int(minute)
        if meridiem == "pm" and hour != 12:
            hour += 12
        elif meridiem == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:{minute:02d}"
    match = re.match(r"(\d{1,2})(am|pm)", value)
    if match:
        hour = int(match.group(1))
        meridiem = match.group(2)
        if meridiem == "pm" and hour != 12:
            hour += 12
        elif meridiem == "am" and hour == 12:
            hour = 0
        return f"{hour:02d}:00"
    return value


def _story_operation(prompt: str, blocks: list[ContentBlock]) -> PatchOperation:
    return PatchOperation(
        op="replace",
        path="/blocks/story/data/body",
        value="Updated story text by AI assistant.",
    )


def _catering_operation(prompt: str, blocks: list[ContentBlock]) -> PatchOperation:
    return PatchOperation(
        op="replace",
        path="/blocks/catering/data/body",
        value="Updated catering information by AI assistant.",
    )


def _links_operation(prompt: str, blocks: list[ContentBlock]) -> list[PatchOperation]:
    lowered = prompt.lower()
    platform = None
    platforms = {
        "instagram",
        "facebook",
        "tiktok",
        "google",
        "yelp",
        "doordash",
        "ubereats",
        "grubhub",
    }
    for p in platforms:
        if p in lowered:
            platform = p
            break
    if not platform:
        return []
    return [
        PatchOperation(
            op="add",
            path="/blocks/footer/data/social_links",
            value={"platform": platform, "url": f"https://{platform}.com/example"},
        )
    ]


def generate_change_preview(
    prompt: str,
    blocks: list[ContentBlock],
    tenant_id: uuid.UUID,
    site_id: uuid.UUID,
) -> ChangePreview:
    """Deterministic, schema-bound transformer used as the local fallback.

    This stub is used in development and tests, and as a graceful degradation
    path when the configured LLM provider is unavailable or returns malformed
    output. In production, ``infrastructure.llm.LLMProvider`` routes requests to
    Gemini when ``GEMINI_API_KEY`` is configured; all LLM output is still
    validated against the ``ChangePreview`` schema and patched through the same
    allowlist as this stub.
    """
    prompt = _sanitize_prompt(prompt)
    if len(prompt) > 2000 or not _is_prompt_in_scope(prompt):
        return ChangePreview(
            in_scope=False,
            confidence=0.0,
            summary="That request is outside the assistant's allowed scope.",
            operations=[],
        )

    lowered = prompt.lower()
    operations: list[PatchOperation] = []

    if "hero" in lowered or "headline" in lowered or "tagline" in lowered:
        op = _hero_operation(prompt, blocks)
        if op:
            operations.append(op)
    elif "menu" in lowered or "vegan" in lowered or "add " in lowered:
        operations.extend(_menu_operation(prompt, blocks))
    elif "hour" in lowered or any(day in lowered for day in _DAYS):
        op = _hours_operation(prompt, blocks)
        if op:
            operations.append(op)
    elif "story" in lowered or "about" in lowered:
        operations.append(_story_operation(prompt, blocks))
    elif "catering" in lowered:
        operations.append(_catering_operation(prompt, blocks))
    elif any(
        keyword in lowered
        for keyword in {
            "instagram",
            "facebook",
            "tiktok",
            "social",
            "doordash",
            "ubereats",
            "grubhub",
            "google",
            "yelp",
        }
    ):
        operations.extend(_links_operation(prompt, blocks))
    else:
        return ChangePreview(
            in_scope=False,
            confidence=0.0,
            summary=(
                "The assistant can only edit hero, menu, hours, story, catering, or social links."
            ),
            operations=[],
        )

    return ChangePreview(
        in_scope=True,
        confidence=0.9,
        summary=f"Proposed {len(operations)} change(s) based on your request.",
        operations=operations,
    )


def validate_patch_path(path: str) -> tuple[str, list[str]]:
    """Validate a patch path is on the allowlist and return (block_type, segments)."""
    if not path.startswith("/blocks/"):
        raise ValueError(f"Patch path must start with /blocks/: {path}")
    segments = path.split("/")[2:]  # ['blocks', type, 'data', ...]
    if len(segments) < 3 or segments[1] != "data":
        raise ValueError(f"Invalid patch path: {path}")
    block_type = segments[0]
    if block_type not in {bt.value for bt in ContentBlockType}:
        raise ValueError(f"Unknown block type in patch path: {block_type}")
    field = segments[2]

    if block_type == ContentBlockType.HERO.value and field not in _ALLOWED_HERO_FIELDS:
        raise ValueError(f"Field not allowed for hero: {field}")
    if block_type == ContentBlockType.STORY.value and field not in _ALLOWED_STORY_FIELDS:
        raise ValueError(f"Field not allowed for story: {field}")
    if block_type == ContentBlockType.CATERING.value and field not in _ALLOWED_CATERING_FIELDS:
        raise ValueError(f"Field not allowed for catering: {field}")
    if block_type == ContentBlockType.CONTACT.value and field not in _ALLOWED_CONTACT_FIELDS:
        raise ValueError(f"Field not allowed for contact: {field}")
    if block_type == ContentBlockType.FOOTER.value and field not in _ALLOWED_FOOTER_FIELDS:
        raise ValueError(f"Field not allowed for footer: {field}")

    if block_type == ContentBlockType.LOCATIONS.value:
        if field != "locations" or len(segments) < 5:
            raise ValueError(f"Invalid locations patch path: {path}")
        loc_field = segments[4]
        if loc_field == "hours":
            if len(segments) != 6 or segments[5] not in _DAYS:
                raise ValueError(f"Invalid hours patch path: {path}")
        elif loc_field not in _ALLOWED_LOCATION_FIELDS:
            raise ValueError(f"Field not allowed for location: {loc_field}")

    if block_type == ContentBlockType.MENU.value:
        if field != "categories":
            raise ValueError(f"Invalid menu patch path: {path}")

    if block_type == ContentBlockType.ORDER_LINKS.value and field != "links":
        raise ValueError(f"Invalid order_links patch path: {path}")

    return block_type, segments


def apply_patch_operations(
    blocks: list[ContentBlock], operations: list[dict[str, Any]]
) -> list[ContentBlock]:
    """Apply allowlisted patch operations to a list of content blocks in place."""
    for raw_op in operations:
        op = PatchOperation(**raw_op)
        block_type, segments = validate_patch_path(op.path)
        block_index = _find_block_index(blocks, block_type)
        if block_index < 0:
            raise ValueError(f"Block type not found on site: {block_type}")
        block = blocks[block_index]

        if len(segments) == 3:
            field = segments[2]
            if op.op == "replace":
                block.data[field] = op.value
            elif op.op == "remove":
                block.data.pop(field, None)
            elif op.op == "add":
                if field in block.data and isinstance(block.data[field], list):
                    block.data[field].append(op.value)
                else:
                    block.data[field] = op.value
            validate_block_data(block_type, block.data)
            continue

        if block_type == ContentBlockType.LOCATIONS.value:
            loc_index = int(segments[3])
            loc_field = segments[4]
            locations = block.data.setdefault("locations", [])
            while len(locations) <= loc_index:
                locations.append(LocationData().model_dump())
            if loc_field == "hours":
                day = segments[5]
                locations[loc_index].setdefault("hours", {})[day] = op.value
            else:
                if op.op in {"replace", "add"}:
                    locations[loc_index][loc_field] = op.value
                elif op.op == "remove":
                    locations[loc_index].pop(loc_field, None)
            validate_block_data(block_type, block.data)
            continue

        if block_type == ContentBlockType.MENU.value:
            categories = block.data.setdefault("categories", [])
            if len(segments) == 3 and op.op == "add":
                categories.append(op.value)
            elif len(segments) == 5:
                cat_index = int(segments[3])
                cat_field = segments[4]
                while len(categories) <= cat_index:
                    categories.append(MenuCategory(title="New Category").model_dump())
                if op.op in {"replace", "add"}:
                    categories[cat_index][cat_field] = op.value
                elif op.op == "remove":
                    categories[cat_index].pop(cat_field, None)
            elif len(segments) == 6 and segments[4] == "items":
                cat_index = int(segments[3])
                while len(categories) <= cat_index:
                    categories.append(MenuCategory(title="New Category").model_dump())
                items = categories[cat_index].setdefault("items", [])
                if op.op == "add":
                    items.append(op.value)
                elif op.op == "replace":
                    item_index = int(segments[5])
                    while len(items) <= item_index:
                        items.append(MenuItem(name="New Item").model_dump())
                    items[item_index] = op.value
                elif op.op == "remove":
                    item_index = int(segments[5])
                    if 0 <= item_index < len(items):
                        items.pop(item_index)
            elif len(segments) == 7 and segments[4] == "items":
                cat_index = int(segments[3])
                item_index = int(segments[5])
                item_field = segments[6]
                while len(categories) <= cat_index:
                    categories.append(MenuCategory(title="New Category").model_dump())
                items = categories[cat_index].setdefault("items", [])
                while len(items) <= item_index:
                    items.append(MenuItem(name="New Item").model_dump())
                if op.op in {"replace", "add"}:
                    items[item_index][item_field] = op.value
                elif op.op == "remove":
                    items[item_index].pop(item_field, None)
            validate_block_data(block_type, block.data)
            continue

        raise ValueError(f"Unsupported patch path: {op.path}")

    return blocks


# ---------------------------------------------------------------------------
# Preview token helpers
# ---------------------------------------------------------------------------


def sign_preview_token(site_id: uuid.UUID, secret: str, ttl_seconds: int = 900) -> str:
    """Return a short-lived HMAC-signed preview token bound to a site."""
    exp = int((datetime.now(UTC) + timedelta(seconds=ttl_seconds)).timestamp())
    payload = f"{site_id}:{exp}"
    signature = hmac.new(
        secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    ).hexdigest()
    return f"{payload}:{signature}"


def verify_preview_token(token: str, site_id: uuid.UUID, secret: str) -> bool:
    try:
        payload_id, exp_str, signature = token.rsplit(":", 2)
        if uuid.UUID(payload_id) != site_id:
            return False
        if int(exp_str) < int(datetime.now(UTC).timestamp()):
            return False
        expected = hmac.new(
            secret.encode("utf-8"),
            f"{payload_id}:{exp_str}".encode(),
            hashlib.sha256,
        ).hexdigest()
        return hmac.compare_digest(signature, expected)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Onboarding builder
# ---------------------------------------------------------------------------


def build_onboarding_result(
    user_id: uuid.UUID,
    tenant_id: uuid.UUID,
    business_name: str,
    slug: str,
    template_id: str,
    brand_colors: dict[str, Any],
) -> tuple[FoodcartTenant, Site]:
    tenant = FoodcartTenant(
        id=tenant_id,
        owner_user_id=user_id,
        name=business_name,
        slug=slug,
        status=FoodcartTenantStatus.ACTIVE,
        billing_status=FoodcartBillingStatus.TRIAL,
    )
    site = Site(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        slug=slug,
        template_id=template_id,
        publish_state=SitePublishState.DRAFT,
        seo={"title": business_name, "description": f"Welcome to {business_name}"},
        brand_colors=brand_colors,
    )
    return tenant, site


__all__ = [
    "ChangePreview",
    "PatchOperation",
    "HeroBlockData",
    "StoryBlockData",
    "MenuBlockData",
    "LocationsBlockData",
    "CateringBlockData",
    "ContactBlockData",
    "OrderLinksBlockData",
    "FooterBlockData",
    "LocationData",
    "MenuCategory",
    "MenuItem",
    "OpenClosedStatus",
    "LocationStatus",
    "URLNotAllowedError",
    "normalize_slug",
    "is_valid_slug",
    "suggest_slugs",
    "validate_public_url",
    "compute_location_status",
    "validate_block_data",
    "default_blocks_for_template",
    "run_ingestion_job",
    "merge_ingestion_into_blocks",
    "generate_change_preview",
    "apply_patch_operations",
    "validate_patch_path",
    "sign_preview_token",
    "verify_preview_token",
    "build_onboarding_result",
]
