"""Subscription billing router (Paddle Billing)."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_current_user, get_db
from app.exceptions import NotFoundError
from app.schemas_foodcart import (
    BillingInterval,
    BillingPlansResponse,
    CheckoutRequest,
    CheckoutResponse,
    ErrorSchema,
    PlanSchema,
    PortalResponse,
    SubscriptionResponse,
)
from app.services import paddle_service
from infrastructure import models

router = APIRouter(prefix="/billing", tags=["Billing"])


def _get_foodcart_tenant(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.FoodcartTenant:
    """Return the Foodcart tenant row for the authenticated user."""
    tenant = (
        db.query(models.FoodcartTenant)
        .filter(models.FoodcartTenant.id == user.tenant_id)
        .first()
    )
    if not tenant:
        raise NotFoundError("Tenant not onboarded")
    return tenant


def _get_user(
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> models.User:
    """Return the full User ORM row for the authenticated user."""
    orm = db.query(models.User).filter(models.User.id == user.id).first()
    if not orm:
        raise NotFoundError("User not found")
    return orm


@router.get("/plans", response_model=BillingPlansResponse)
def list_plans() -> BillingPlansResponse:
    """Return the available subscription plans with pricing."""
    return BillingPlansResponse(
        monthly=PlanSchema(
            id="base-monthly",
            name="Base Subscription",
            interval=BillingInterval.month,
            price_usd="50.00",
        ),
        yearly=PlanSchema(
            id="base-yearly",
            name="Base Subscription",
            interval=BillingInterval.year,
            price_usd="400.00",
        ),
    )


@router.get("/current", response_model=SubscriptionResponse)
def get_current_subscription(
    tenant: models.FoodcartTenant = Depends(_get_foodcart_tenant),
) -> SubscriptionResponse:
    """Return the current subscription state for the tenant."""
    return SubscriptionResponse(
        plan=tenant.plan,
        status=tenant.subscription_status,
        billing_interval=tenant.billing_interval,
        current_period_start=tenant.subscription_current_period_start,
        current_period_end=tenant.subscription_current_period_end,
        trial_ends_at=tenant.trial_ends_at,
        canceled_at=tenant.canceled_at,
        paddle_subscription_id=tenant.paddle_subscription_id,
        paddle_customer_id=tenant.paddle_customer_id,
    )


@router.post(
    "/checkout",
    response_model=CheckoutResponse,
    responses={400: {"model": ErrorSchema}},
)
def create_checkout(
    payload: CheckoutRequest,
    tenant: models.FoodcartTenant = Depends(_get_foodcart_tenant),
    user: models.User = Depends(_get_user),
) -> CheckoutResponse:
    """Create a Paddle checkout for the requested billing interval."""
    try:
        url = paddle_service.create_checkout(tenant, user, payload.interval.value)
    except paddle_service.PaddleError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return CheckoutResponse(checkout_url=url)


@router.post("/portal", response_model=PortalResponse)
def create_portal(
    tenant: models.FoodcartTenant = Depends(_get_foodcart_tenant),
) -> PortalResponse:
    """Create a Paddle customer portal session for the tenant owner."""
    try:
        url = paddle_service.create_customer_portal(tenant)
    except paddle_service.PaddleError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return PortalResponse(url=url)


@router.post("/cancel", response_model=SubscriptionResponse)
def cancel_subscription(
    tenant: models.FoodcartTenant = Depends(_get_foodcart_tenant),
    db: Session = Depends(get_db),
) -> SubscriptionResponse:
    """Schedule the active subscription to cancel at the end of the period."""
    if not tenant.paddle_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription to cancel",
        )
    try:
        paddle_service.cancel_subscription_at_period_end(tenant.paddle_subscription_id)
    except paddle_service.PaddleError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    # Optimistically update local state; webhooks will reconcile.
    tenant.canceled_at = datetime.now(UTC)
    db.commit()

    return get_current_subscription(tenant)


@router.post("/resume", response_model=SubscriptionResponse)
def resume_subscription(
    tenant: models.FoodcartTenant = Depends(_get_foodcart_tenant),
    db: Session = Depends(get_db),
) -> SubscriptionResponse:
    """Undo a scheduled cancellation."""
    if not tenant.paddle_subscription_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active subscription to resume",
        )
    try:
        paddle_service.resume_subscription(tenant.paddle_subscription_id)
    except paddle_service.PaddleError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    tenant.canceled_at = None
    db.commit()

    return get_current_subscription(tenant)
