"""Paddle Billing integration service.

Thin wrapper around the official paddle-python-sdk. Keeps credential handling,
checkout creation, customer portal generation, and webhook verification in one
place so routers stay small and testable.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, cast

from paddle_billing import Client, Environment, Options
from paddle_billing.Entities.Shared.CustomData import CustomData
from paddle_billing.Notifications.PaddleSignature import PaddleSignature
from paddle_billing.Notifications.Secret import Secret
from paddle_billing.Resources.CustomerPortalSessions.Operations.CreateCustomerPortalSession import (
    CreateCustomerPortalSession,
)
from paddle_billing.Resources.Customers.Operations.CreateCustomer import CreateCustomer
from paddle_billing.Resources.Subscriptions.Operations.CancelSubscription import CancelSubscription
from paddle_billing.Resources.Subscriptions.Operations.Update.SubscriptionUpdateItem import (
    SubscriptionUpdateItem,
)
from paddle_billing.Resources.Subscriptions.Operations.UpdateSubscription import UpdateSubscription
from paddle_billing.Resources.Transactions.Operations.Create.TransactionCreateItem import (
    TransactionCreateItem,
)
from paddle_billing.Resources.Transactions.Operations.CreateTransaction import CreateTransaction

from app.config import settings
from infrastructure.models import FoodcartTenant, User


class PaddleError(Exception):
    """Raised when a Paddle API call fails."""

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.code = code


@lru_cache(maxsize=1)
def get_paddle_client() -> Client:
    """Return a configured Paddle client (cached for the process lifetime)."""
    if not settings.paddle_api_key:
        raise PaddleError("PADDLE_API_KEY is not configured")

    environment = (
        Environment.PRODUCTION
        if settings.paddle_environment == "production"
        else Environment.SANDBOX
    )
    return Client(
        settings.paddle_api_key,
        options=Options(environment=environment),
        timeout=30.0,
    )


def _environment() -> Environment:
    return (
        Environment.PRODUCTION
        if settings.paddle_environment == "production"
        else Environment.SANDBOX
    )


def _custom_data(tenant: FoodcartTenant, user: User | None = None) -> CustomData:
    data: dict[str, str] = {"tenant_id": str(tenant.id)}
    if user:
        data["user_id"] = str(user.id)
    return CustomData(data)


def _price_id_for_interval(interval: str) -> str:
    if interval == "year":
        if not settings.paddle_price_yearly_id:
            raise PaddleError("PADDLE_PRICE_YEARLY_ID is not configured")
        return settings.paddle_price_yearly_id
    if not settings.paddle_price_monthly_id:
        raise PaddleError("PADDLE_PRICE_MONTHLY_ID is not configured")
    return settings.paddle_price_monthly_id


def get_or_create_customer(tenant: FoodcartTenant, user: User) -> str:
    """Return an existing Paddle customer id or create one for the tenant."""
    client = get_paddle_client()

    if tenant.paddle_customer_id:
        return tenant.paddle_customer_id

    try:
        customer = client.customers.create(
            CreateCustomer(
                email=user.email,
                name=user.name,
                custom_data=_custom_data(tenant, user),
            )
        )
    except Exception as exc:
        raise PaddleError(f"Failed to create Paddle customer: {exc}") from exc

    tenant.paddle_customer_id = cast(str, customer.id)
    return cast(str, customer.id)


def create_checkout(tenant: FoodcartTenant, user: User, interval: str) -> str:
    """Create a Paddle checkout transaction and return the checkout URL."""
    client = get_paddle_client()
    customer_id = get_or_create_customer(tenant, user)
    price_id = _price_id_for_interval(interval)

    try:
        transaction = client.transactions.create(
            CreateTransaction(
                items=[TransactionCreateItem(price_id=price_id, quantity=1)],
                customer_id=customer_id,
                custom_data=_custom_data(tenant, user),
                collection_mode="automatic",
            )
        )
    except Exception as exc:
        raise PaddleError(f"Failed to create Paddle checkout: {exc}") from exc

    # The checkout URL is returned in the transaction's management URLs or
    # checkout object depending on Paddle's response shape. Prefer the direct
    # checkout URL when present.
    if transaction.checkout and transaction.checkout.url:
        return cast(str, transaction.checkout.url)

    if transaction.management_urls and transaction.management_urls.checkout:
        return cast(str, transaction.management_urls.checkout)

    raise PaddleError("Paddle checkout URL not returned")


def create_customer_portal(tenant: FoodcartTenant) -> str:
    """Create a Paddle customer portal session for the tenant owner."""
    client = get_paddle_client()
    if not tenant.paddle_customer_id:
        raise PaddleError("Tenant does not have a Paddle customer")

    operation = CreateCustomerPortalSession()
    if tenant.paddle_subscription_id:
        operation = CreateCustomerPortalSession(subscription_ids=[tenant.paddle_subscription_id])

    try:
        portal = client.customer_portal_sessions.create(tenant.paddle_customer_id, operation)
    except Exception as exc:
        raise PaddleError(f"Failed to create Paddle portal session: {exc}") from exc

    return cast(str, portal.url)


def get_subscription(subscription_id: str) -> Any:
    """Fetch a subscription from Paddle."""
    client = get_paddle_client()
    try:
        return client.subscriptions.get(subscription_id)
    except Exception as exc:
        raise PaddleError(f"Failed to fetch subscription: {exc}") from exc


def cancel_subscription_at_period_end(subscription_id: str) -> Any:
    """Schedule a subscription to cancel at the end of the current period."""
    client = get_paddle_client()
    try:
        return client.subscriptions.cancel(
            subscription_id,
            CancelSubscription(effective_from="next_billing_period"),
        )
    except Exception as exc:
        raise PaddleError(f"Failed to cancel subscription: {exc}") from exc


def resume_subscription(subscription_id: str) -> Any:
    """Undo a scheduled cancellation by clearing the scheduled change."""
    client = get_paddle_client()
    try:
        return client.subscriptions.update(
            subscription_id,
            UpdateSubscription(scheduled_change=None),
        )
    except Exception as exc:
        raise PaddleError(f"Failed to resume subscription: {exc}") from exc


def change_subscription_interval(subscription_id: str, interval: str) -> Any:
    """Change an active subscription's billing interval (month/year)."""
    client = get_paddle_client()
    price_id = _price_id_for_interval(interval)
    try:
        return client.subscriptions.update(
            subscription_id,
            UpdateSubscription(
                items=[SubscriptionUpdateItem(price_id=price_id, quantity=1)],
                proration_billing_mode="prorated_immediately",
            ),
        )
    except Exception as exc:
        raise PaddleError(f"Failed to update subscription interval: {exc}") from exc


def verify_webhook_signature(signature_header: str, raw_body: bytes) -> bool:
    """Verify a Paddle webhook signature using the configured webhook secret."""
    if not settings.paddle_webhook_secret:
        raise PaddleError("PADDLE_WEBHOOK_SECRET is not configured")

    try:
        return bool(
            PaddleSignature().verify(
                signature_header=signature_header,
                raw_body=raw_body.decode("utf-8"),
                secrets=Secret(settings.paddle_webhook_secret),
            )
        )
    except ConnectionRefusedError as exc:
        raise PaddleError("Paddle webhook signature verification failed") from exc
    except Exception as exc:
        raise PaddleError(f"Paddle webhook verification error: {exc}") from exc


def subscription_status_to_billing_status(status: str | None) -> str:
    """Map a Paddle subscription status to the internal billing_status enum."""
    if status is None:
        return "trial"
    mapping = {
        "active": "active",
        "trialing": "active",  # trial is considered active for access gating
        "past_due": "past_due",
        "canceled": "canceled",
        "paused": "past_due",  # paused users lose paid access until resolved
    }
    return mapping.get(status, "trial")


def parse_webhook_event(raw_body: bytes) -> dict[str, Any]:
    """Parse a raw webhook body into a Python dict (no signature verification)."""
    import json

    return cast(dict[str, Any], json.loads(raw_body.decode("utf-8")))
