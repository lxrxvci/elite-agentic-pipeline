"""Domain purchase orchestration.

Combines registrar availability/pricing with Paddle one-time checkout, then
registers the domain after Paddle reports a completed transaction.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import cast
from uuid import UUID

from paddle_billing import Client
from paddle_billing.Entities.Shared.CurrencyCode import CurrencyCode
from paddle_billing.Entities.Shared.CustomData import CustomData
from paddle_billing.Entities.Shared.Money import Money
from paddle_billing.Resources.Transactions.Operations.Create.TransactionCreateItemWithPrice import (
    TransactionCreateItemWithPrice,
)
from paddle_billing.Resources.Transactions.Operations.CreateTransaction import CreateTransaction
from paddle_billing.Resources.Transactions.Operations.Price.TransactionNonCatalogPrice import (
    TransactionNonCatalogPrice,
)
from sqlalchemy.orm import Session

from app.config import settings
from app.services.domain_service import DomainValidationError, validate_custom_domain
from app.services.paddle_service import PaddleError, get_paddle_client
from app.services.registrar_service import (
    DomainAvailability,
    RegistrarClient,
    RegistrarError,
)
from infrastructure import models


def _cost_to_cents(cost: str) -> int:
    try:
        return int(Decimal(cost) * 100)
    except InvalidOperation as exc:
        raise PaddleError(f"Invalid registrar price: {cost}") from exc


def _total_cents(registrar_cost_cents: int, markup_cents: int) -> int:
    return registrar_cost_cents + markup_cents


def _create_non_catalog_price(
    client: Client,
    domain: str,
    total_cents: int,
) -> TransactionCreateItemWithPrice:
    if not settings.paddle_domain_product_id:
        raise PaddleError("PADDLE_DOMAIN_PRODUCT_ID is not configured")

    return TransactionCreateItemWithPrice(
        quantity=1,
        price=TransactionNonCatalogPrice(
            description=f"Domain registration: {domain}",
            unit_price=Money(amount=str(total_cents), currency_code=CurrencyCode("USD")),
            product_id=settings.paddle_domain_product_id,
            name=domain,
        ),
    )


def get_domain_quote(client: RegistrarClient, domain: str) -> DomainAvailability:
    """Return availability and pricing for a single domain."""
    results = client.check_availability([domain])
    if not results:
        raise RegistrarError("No availability response from registrar")
    return results[0]


def create_domain_checkout(
    db: Session,
    client: RegistrarClient,
    domain: str,
    site: models.Site,
    user: models.User,
) -> dict[str, str]:
    """Create a Paddle checkout for a domain purchase.

    Returns a dict with the checkout_url and the total amount charged.
    """
    quote = get_domain_quote(client, domain)
    if not quote.registrable:
        raise DomainValidationError(f"Domain is not available: {quote.reason or 'unknown'}")

    normalized = validate_custom_domain(db, domain, expected_site_id=site.id)
    registrar_cents = _cost_to_cents(quote.registration_cost)
    total = _total_cents(registrar_cents, settings.domain_markup_cents)

    paddle = get_paddle_client()
    item = _create_non_catalog_price(paddle, normalized, total)

    try:
        transaction = paddle.transactions.create(
            CreateTransaction(
                items=[item],
                customer_id=_ensure_customer(db, site, user),
                custom_data=CustomData(
                    {
                        "tenant_id": str(site.tenant_id),
                        "site_id": str(site.id),
                        "domain": normalized,
                        "domain_purchase": "true",
                    }
                ),
                collection_mode="automatic",
            )
        )
    except Exception as exc:
        raise PaddleError(f"Failed to create Paddle checkout: {exc}") from exc

    url = cast(str, transaction.checkout.url) if transaction.checkout else ""
    if not url:
        raise PaddleError("Paddle checkout URL not returned")

    return {
        "checkout_url": url,
        "domain": normalized,
        "total": f"{total / 100:.2f}",
        "currency": quote.currency,
    }


def register_domain_after_payment(
    db: Session,
    client: RegistrarClient,
    domain: str,
    site_id: UUID,
    transaction_id: str,
) -> models.Site:
    """Register a domain after a successful Paddle transaction.

    This is designed to be called from the Paddle webhook handler when a
    ``transaction.completed`` event with ``domain_purchase=true`` is received.
    """
    site = db.query(models.Site).filter(models.Site.id == site_id).first()
    if not site:
        raise DomainValidationError("Site not found")

    normalized = validate_custom_domain(db, domain, expected_site_id=site.id, skip_dns=True)

    try:
        registration = client.register_domain(normalized)
    except RegistrarError:
        site.domain_status = "error"
        db.commit()
        raise

    site.custom_domain = normalized
    site.domain_status = "active"
    site.domain_provider = "cloudflare"
    site.domain_paddle_transaction_id = transaction_id
    site.domain_registered_at = registration.created_at
    site.domain_expires_at = registration.expires_at
    db.commit()
    return site


def _ensure_customer(db: Session, site: models.Site, user: models.User) -> str:
    """Return the Paddle customer id for the tenant, creating one if needed."""
    from app.services.paddle_service import get_or_create_customer

    tenant = (
        db.query(models.FoodcartTenant)
        .filter(models.FoodcartTenant.id == site.tenant_id)
        .first()
    )
    if tenant is None:
        raise PaddleError("Tenant not onboarded")
    return get_or_create_customer(tenant, user)
