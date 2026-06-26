"""Domain purchase and registrar lookup router (Phase 3)."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.dependencies import CurrentUser, get_db, require_paid_plan, require_role
from app.exceptions import NotFoundError, ValidationError
from app.schemas_foodcart import (
    DomainAvailabilitySchema,
    DomainPurchaseRequestSchema,
    DomainPurchaseResponseSchema,
    DomainSearchResponseSchema,
    ErrorSchema,
)
from app.services.domain_purchase import create_domain_checkout
from app.services.domain_service import DomainValidationError
from app.services.paddle_service import PaddleError
from app.services.registrar_service import DomainAvailability, RegistrarError, get_registrar_client
from infrastructure import models

router = APIRouter(prefix="/domains", tags=["Domains"])


def _get_site(db: Session, site_id: uuid.UUID, tenant_id: uuid.UUID) -> models.Site:
    site = (
        db.query(models.Site)
        .filter(models.Site.id == site_id)
        .filter(models.Site.tenant_id == tenant_id)
        .first()
    )
    if not site:
        raise NotFoundError("Site not found")
    return site


def _to_schema(result: DomainAvailability) -> DomainAvailabilitySchema:
    return DomainAvailabilitySchema(
        name=result.name,
        registrable=result.registrable,
        currency=result.currency,
        registration_cost=result.registration_cost,
        renewal_cost=result.renewal_cost,
        reason=result.reason,
    )


@router.get("/search", response_model=DomainSearchResponseSchema)
def search_domains(
    q: str,
    user: CurrentUser = Depends(require_role("owner")),
    _: CurrentUser = Depends(require_paid_plan()),
) -> DomainSearchResponseSchema:
    """Search for candidate domain names via the configured registrar."""
    try:
        results = get_registrar_client().search(q)
    except RegistrarError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.message,
        ) from exc

    return DomainSearchResponseSchema(query=q, domains=[_to_schema(r) for r in results])


@router.post("/check", response_model=DomainSearchResponseSchema)
def check_domains(
    payload: list[str],
    user: CurrentUser = Depends(require_role("owner")),
    _: CurrentUser = Depends(require_paid_plan()),
) -> DomainSearchResponseSchema:
    """Check real-time availability and pricing for up to 20 domains."""
    if len(payload) > 20:
        raise ValidationError("Cannot check more than 20 domains at once")

    try:
        results = get_registrar_client().check_availability(payload)
    except RegistrarError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.message,
        ) from exc

    return DomainSearchResponseSchema(
        query=", ".join(payload), domains=[_to_schema(r) for r in results]
    )


@router.post(
    "/sites/{site_id}/purchase",
    response_model=DomainPurchaseResponseSchema,
    responses={
        402: {"model": ErrorSchema},
        404: {"model": ErrorSchema},
        422: {"model": ErrorSchema},
        503: {"model": ErrorSchema},
    },
)
def purchase_domain(
    site_id: uuid.UUID,
    payload: DomainPurchaseRequestSchema,
    user: CurrentUser = Depends(require_role("owner")),
    _: CurrentUser = Depends(require_paid_plan()),
    db: Session = Depends(get_db),
) -> DomainPurchaseResponseSchema:
    """Start a domain purchase for a site and return a Paddle checkout URL."""
    site = _get_site(db, site_id, user.tenant_id)

    user_orm = db.query(models.User).filter(models.User.id == user.id).first()
    if not user_orm:
        raise NotFoundError("User not found")

    try:
        result = create_domain_checkout(
            db, get_registrar_client(), payload.domain, site, user_orm
        )
    except DomainValidationError as exc:
        raise ValidationError(str(exc)) from exc
    except RegistrarError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=exc.message,
        ) from exc
    except PaddleError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    return DomainPurchaseResponseSchema(**result)
