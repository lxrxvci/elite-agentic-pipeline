"""Paddle webhook receiver.

This router must receive the raw request body so that Paddle-Signature
verification works. Register it before any body-parsing middleware/router
that would consume the stream.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.services import paddle_service
from infrastructure import models
from infrastructure.database import get_db

router = APIRouter(prefix="/webhooks", tags=["Webhooks"])


def _parse_iso(value: str | None) -> datetime | None:
    """Parse an ISO-8601 timestamp from a webhook payload."""
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _update_tenant_from_subscription(
    db: Session,
    subscription: dict[str, Any],
) -> bool:
    """Update the FoodcartTenant row from a Paddle subscription object.

    Returns True if a matching tenant was found and updated.
    """
    custom_data = subscription.get("custom_data") or {}
    tenant_id_str = custom_data.get("tenant_id")
    if not tenant_id_str:
        return False

    try:
        from uuid import UUID

        tenant_id = UUID(tenant_id_str)
    except ValueError:
        return False

    tenant = (
        db.query(models.FoodcartTenant)
        .filter(models.FoodcartTenant.id == tenant_id)
        .first()
    )
    if not tenant:
        return False

    tenant.paddle_subscription_id = subscription.get("id")
    tenant.paddle_customer_id = subscription.get("customer_id")
    tenant.subscription_status = subscription.get("status")
    tenant.billing_interval = _interval_from_billing_cycle(
        subscription.get("billing_cycle")
    )

    current_period = subscription.get("current_billing_period") or {}
    tenant.subscription_current_period_start = _parse_iso(
        current_period.get("starts_at")
    )
    tenant.subscription_current_period_end = _parse_iso(
        current_period.get("ends_at")
    )

    tenant.trial_ends_at = _parse_iso(subscription.get("trial_ended_at"))
    tenant.canceled_at = _parse_iso(subscription.get("canceled_at"))

    # Map Paddle status to internal billing_status for simple gating.
    tenant.billing_status = paddle_service.subscription_status_to_billing_status(
        tenant.subscription_status
    )

    # If the subscription is active/trialing, it is no longer in a platform trial.
    if tenant.subscription_status in ("active", "trialing"):
        tenant.billing_status = "active"

    db.commit()
    return True


def _interval_from_billing_cycle(billing_cycle: dict[str, Any] | None) -> str | None:
    """Extract 'month' or 'year' from a Paddle billing_cycle dict."""
    if not billing_cycle:
        return None
    interval = billing_cycle.get("interval")
    frequency = billing_cycle.get("frequency", 1)
    if interval == "month" and frequency == 1:
        return "month"
    if interval == "year" and frequency == 1:
        return "year"
    return interval


@router.post("/paddle")
async def paddle_webhook(request: Request) -> dict[str, Any]:
    """Receive and verify Paddle webhook events."""
    raw_body = await request.body()
    signature_header = request.headers.get("Paddle-Signature")
    if not signature_header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Paddle-Signature header",
        )

    try:
        verified = paddle_service.verify_webhook_signature(
            signature_header=signature_header,
            raw_body=raw_body,
        )
    except paddle_service.PaddleError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    if not verified:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Paddle signature verification failed",
        )

    payload = paddle_service.parse_webhook_event(raw_body)
    event_type = payload.get("event_type", "")
    data = payload.get("data") or {}

    db: Session = next(get_db())
    try:
        if event_type.startswith("subscription."):
            _update_tenant_from_subscription(db, data)
        elif event_type == "transaction.completed":
            # A completed one-time transaction may be a domain purchase; record it
            # on the site if the site ID is provided in custom_data.
            _handle_transaction_completed(db, data)
    finally:
        db.close()

    return {"received": True}


def _handle_transaction_completed(
    db: Session,
    transaction: dict[str, Any],
) -> None:
    """Record a completed Paddle transaction on the tenant/site if applicable."""
    custom_data = transaction.get("custom_data") or {}
    site_id_str = custom_data.get("site_id")
    if not site_id_str:
        return
    try:
        from uuid import UUID

        site_id = UUID(site_id_str)
    except ValueError:
        return

    site = db.query(models.Site).filter(models.Site.id == site_id).first()
    if not site:
        return

    if custom_data.get("domain_purchase") == "true":
        domain = custom_data.get("domain")
        if not domain:
            return
        from app.services.domain_purchase import register_domain_after_payment
        from app.services.registrar_service import get_registrar_client

        try:
            register_domain_after_payment(
                db,
                get_registrar_client(),
                domain,
                site_id,
                transaction.get("id", ""),
            )
        except Exception:
            # Logged by exception handler; do not fail the webhook response.
            return
        return

    site.domain_paddle_transaction_id = transaction.get("id")
    site.domain_status = "active"
    site.domain_registered_at = datetime.now(UTC)
    db.commit()
