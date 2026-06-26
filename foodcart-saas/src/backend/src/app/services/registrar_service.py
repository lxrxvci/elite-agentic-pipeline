"""Domain registrar abstraction.

Primary implementation uses the Cloudflare Registrar API (beta). A stub
implementation is used when credentials are not configured so tests and local
development can exercise the purchase flow without real API calls.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast

import httpx

from app.config import settings


class RegistrarError(Exception):
    """Raised when a registrar operation fails."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.code = code


@dataclass
class DomainAvailability:
    name: str
    registrable: bool
    currency: str
    registration_cost: str
    renewal_cost: str
    reason: str | None = None


@dataclass
class DomainRegistration:
    domain_name: str
    status: str
    created_at: datetime
    expires_at: datetime


class RegistrarClient(ABC):
    """Abstract domain registrar client."""

    @abstractmethod
    def search(self, query: str, *, limit: int = 5) -> list[DomainAvailability]:
        """Return candidate domains matching *query*."""

    @abstractmethod
    def check_availability(
        self, domains: list[str]
    ) -> list[DomainAvailability]:
        """Return real-time availability and pricing for *domains*."""

    @abstractmethod
    def register_domain(self, domain: str) -> DomainRegistration:
        """Register *domain* and return registration details."""

    @abstractmethod
    def get_registration(self, domain: str) -> DomainRegistration:
        """Return current registration details for *domain*."""


def get_registrar_client() -> RegistrarClient:
    """Return the configured registrar client."""
    if settings.cloudflare_registrar_enabled:
        return CloudflareRegistrarClient()
    return StubRegistrarClient()


class CloudflareRegistrarClient(RegistrarClient):
    """Cloudflare Registrar API (beta) client.

    Docs: https://developers.cloudflare.com/registrar/registrar-api/
    """

    def __init__(self) -> None:
        if not settings.cloudflare_api_token or not settings.cloudflare_account_id:
            raise RegistrarError("Cloudflare API token and account id are required")
        self._base_url = "https://api.cloudflare.com/client/v4"
        self._client = httpx.Client(
            base_url=self._base_url,
            headers={"Authorization": f"Bearer {settings.cloudflare_api_token}"},
            timeout=30.0,
        )

    def _request(
        self, method: str, path: str, json: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        response = self._client.request(method, path, json=json)
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            body = exc.response.text
            raise RegistrarError(
                f"Cloudflare API error: {exc.response.status_code} {body}",
                code="registrar_api_error",
            ) from exc
        data = response.json()
        if not data.get("success"):
            errors = data.get("errors", [])
            if errors:
                message = errors[0].get("message", "Unknown Cloudflare error")
            else:
                message = "Unknown Cloudflare error"
            raise RegistrarError(message, code="registrar_api_error")
        return cast(dict[str, Any], data.get("result", {}))

    def search(self, query: str, *, limit: int = 5) -> list[DomainAvailability]:
        result = self._request(
            "GET",
            f"/accounts/{settings.cloudflare_account_id}/registrar/domain-search",
        )
        domains = result.get("domains", [])
        return [_parse_availability(d) for d in domains[:limit]]

    def check_availability(
        self, domains: list[str]
    ) -> list[DomainAvailability]:
        if len(domains) > 20:
            raise RegistrarError("Cannot check more than 20 domains at once")
        result = self._request(
            "POST",
            f"/accounts/{settings.cloudflare_account_id}/registrar/domain-check",
            json={"domains": domains},
        )
        return [_parse_availability(d) for d in result.get("domains", [])]

    def register_domain(self, domain: str) -> DomainRegistration:
        result = self._request(
            "POST",
            f"/accounts/{settings.cloudflare_account_id}/registrar/registrations",
            json={"domain_name": domain},
        )
        registration = result.get("context", {}).get("registration", {})
        return _parse_registration(registration) if registration else _parse_registration(result)

    def get_registration(self, domain: str) -> DomainRegistration:
        result = self._request(
            "GET",
            f"/accounts/{settings.cloudflare_account_id}/registrar/registrations/{domain}",
        )
        return _parse_registration(result)


class StubRegistrarClient(RegistrarClient):
    """In-memory stub registrar for tests and local development.

    Treats any ``.test`` domain as available with a fixed price and any other
    domain as unavailable.
    """

    def search(self, query: str, *, limit: int = 5) -> list[DomainAvailability]:
        candidates = [f"{query}.test", f"{query}-site.test"]
        return [
            DomainAvailability(
                name=name,
                registrable=True,
                currency="USD",
                registration_cost="10.00",
                renewal_cost="10.00",
            )
            for name in candidates[:limit]
        ]

    def check_availability(
        self, domains: list[str]
    ) -> list[DomainAvailability]:
        result = []
        for domain in domains:
            normalized = domain.lower().strip()
            if normalized.endswith(".test"):
                result.append(
                    DomainAvailability(
                        name=normalized,
                        registrable=True,
                        currency="USD",
                        registration_cost="10.00",
                        renewal_cost="10.00",
                    )
                )
            else:
                result.append(
                    DomainAvailability(
                        name=normalized,
                        registrable=False,
                        currency="USD",
                        registration_cost="0.00",
                        renewal_cost="0.00",
                        reason="extension_not_supported",
                    )
                )
        return result

    def register_domain(self, domain: str) -> DomainRegistration:
        now = datetime.now(UTC)
        return DomainRegistration(
            domain_name=domain,
            status="active",
            created_at=now,
            expires_at=now + timedelta(days=365),
        )

    def get_registration(self, domain: str) -> DomainRegistration:
        return self.register_domain(domain)


def _parse_availability(data: dict[str, Any]) -> DomainAvailability:
    pricing = data.get("pricing", {})
    return DomainAvailability(
        name=data["name"],
        registrable=data.get("registrable", False),
        currency=pricing.get("currency", "USD"),
        registration_cost=pricing.get("registration_cost", "0.00"),
        renewal_cost=pricing.get("renewal_cost", "0.00"),
        reason=data.get("reason"),
    )


def _parse_registration(data: dict[str, Any]) -> DomainRegistration:
    return DomainRegistration(
        domain_name=data.get("domain_name", ""),
        status=data.get("status", "active"),
        created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
        expires_at=datetime.fromisoformat(data["expires_at"].replace("Z", "+00:00")),
    )
