"""Custom-domain validation and helpers.

Provides format normalization, DNS verification, and database-level
uniqueness checks for connect-your-own-domain flows.
"""

from __future__ import annotations

import re
import uuid
from urllib.parse import urlparse

import dns.resolver
from sqlalchemy.orm import Session

from app.config import settings
from infrastructure import models

_DOMAIN_RE = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+"
    r"[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$"
)

_RESERVED_SUBDOMAINS = frozenset({"www", "api", "admin", "app", "mail", "cdn"})


class DomainValidationError(Exception):
    """Raised when a domain fails format or DNS validation."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def normalize_domain(domain: str) -> str:
    """Return a lower-case, no-protocol, no-www hostname.

    Examples:
        "https://Example.com/path" -> "example.com"
        "www.Tacos.dev" -> "tacos.dev"
    """
    value = domain.strip().lower()
    if value.startswith(("http://", "https://")):
        parsed = urlparse(value)
        value = parsed.netloc
    if value.startswith("www."):
        value = value[4:]
    # Remove any trailing path or port that may have survived parsing.
    value = value.split("/")[0].split(":")[0]
    return value


def validate_domain_format(domain: str) -> str:
    """Normalize and validate the domain format.

    Raises:
        DomainValidationError: if the domain is not a valid hostname.
    """
    normalized = normalize_domain(domain)
    if not normalized or len(normalized) > 253:
        raise DomainValidationError("Invalid domain format")
    if normalized in _RESERVED_SUBDOMAINS:
        raise DomainValidationError("Reserved subdomain is not allowed")
    if not _DOMAIN_RE.match(normalized):
        raise DomainValidationError("Invalid domain format")
    # Reject platform subdomains that users do not own.
    if settings.platform_domain and normalized.endswith(f".{settings.platform_domain}"):
        raise DomainValidationError("Cannot use a platform subdomain as a custom domain")
    return normalized


def _resolve_cname(domain: str) -> str | None:
    """Return the canonical name target for *domain*, or None."""
    try:
        answers = dns.resolver.resolve(domain, "CNAME")
        return str(answers[0].target).rstrip(".").lower()
    except (
        dns.resolver.NoAnswer,
        dns.resolver.NXDOMAIN,
        dns.resolver.NoNameservers,
        dns.exception.Timeout,
    ):
        return None


def _resolve_a_records(domain: str) -> frozenset[str]:
    """Return the IPv4 addresses for *domain*, or an empty set on failure."""
    try:
        return frozenset(str(rdata) for rdata in dns.resolver.resolve(domain, "A"))
    except (
        dns.resolver.NoAnswer,
        dns.resolver.NXDOMAIN,
        dns.resolver.NoNameservers,
        dns.exception.Timeout,
    ):
        return frozenset()


def verify_domain_points_to_platform(domain: str) -> tuple[bool, str]:
    """Check whether *domain* resolves to the platform via CNAME or A record.

    Returns:
        (ok, reason) tuple. *reason* describes success or the failure cause.
    """
    if not settings.platform_domain and not settings.platform_host_ip:
        return (True, "DNS validation skipped: platform target not configured")

    cname = _resolve_cname(domain)
    if cname and settings.platform_domain:
        # Allow the apex domain or any wildcard/subdomain that matches.
        if cname == settings.platform_domain.lower():
            return (True, "CNAME record points to platform")

    a_records = _resolve_a_records(domain)
    if settings.platform_host_ip and settings.platform_host_ip in a_records:
        return (True, "A record points to platform")

    if cname:
        return (
            False,
            f"Domain CNAME points to {cname}, expected {settings.platform_domain}",
        )
    if a_records:
        return (
            False,
            f"Domain A record(s) {sorted(a_records)} do not match platform IP",
        )
    return (False, "Domain has no resolvable CNAME or A record")


def validate_custom_domain(
    db: Session,
    domain: str,
    *,
    expected_site_id: uuid.UUID | None = None,
    skip_dns: bool = False,
) -> str:
    """Validate a custom domain for use on a site.

    Checks format, uniqueness, and (when enabled) DNS configuration.

    Args:
        db: Database session.
        domain: Raw domain input from the user.
        expected_site_id: Site id that is allowed to already own this domain.
        skip_dns: If True, bypass the DNS check. Used mainly by tests.

    Returns:
        The normalized domain string.

    Raises:
        DomainValidationError: if validation fails.
    """
    normalized = validate_domain_format(domain)

    existing = (
        db.query(models.Site)
        .filter(models.Site.custom_domain == normalized)
        .first()
    )
    if existing and (expected_site_id is None or existing.id != expected_site_id):
        raise DomainValidationError("Domain is already in use")

    if not skip_dns and settings.domain_dns_validation_enabled:
        ok, reason = verify_domain_points_to_platform(normalized)
        if not ok:
            raise DomainValidationError(reason)

    return normalized
