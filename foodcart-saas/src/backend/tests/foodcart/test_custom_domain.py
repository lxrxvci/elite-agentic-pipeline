"""Tests for the custom-domain connect and routing endpoints."""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.config import settings
from app.dependencies import create_access_token
from infrastructure.models import ContentBlock, FoodcartTenant, Site, Tenant, User


def _make_token(user_id: uuid.UUID, tenant_id: uuid.UUID) -> str:
    return create_access_token(
        user_id=user_id,
        email="owner@example.com",
        name="Owner",
        tenant_id=tenant_id,
    )


@pytest.fixture()
def domain_tenant(db: Session):
    tenant = Tenant(name="Domain Tenant", default_currency="USD")
    db.add(tenant)
    db.flush()

    user = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email="owner@example.com",
        name="Owner",
        role="owner",
    )
    db.add(user)
    db.flush()

    foodcart = FoodcartTenant(
        id=tenant.id,
        owner_user_id=user.id,
        name="Domain Tenant",
        slug="domain-tenant",
        status="active",
        billing_status="active",
        subscription_status="active",
        plan="base",
    )
    db.add(foodcart)
    db.commit()

    original_dns = settings.domain_dns_validation_enabled
    settings.domain_dns_validation_enabled = False

    yield {"tenant": tenant, "user": user, "foodcart": foodcart}

    settings.domain_dns_validation_enabled = original_dns


@pytest.fixture()
def published_site(db: Session, domain_tenant: dict[str, Any]):
    site = Site(
        id=uuid.uuid4(),
        tenant_id=domain_tenant["tenant"].id,
        slug="domain-bites",
        template_id="custom",
        publish_state="published",
        seo={"title": "Domain Bites"},
        brand_colors={"primary": "#2563eb", "secondary": "#f5f5f5", "background": "#ffffff"},
    )
    db.add(site)
    block = ContentBlock(
        id=uuid.uuid4(),
        site_id=site.id,
        tenant_id=domain_tenant["tenant"].id,
        block_type="hero",
        schema_version="1.0",
        data={"headline": "Domain Bites"},
        sort_order=0,
    )
    db.add(block)
    db.commit()
    return site


class TestConnectDomain:
    def test_connect_domain_requires_owner(
        self, client: TestClient, published_site: Site
    ) -> None:
        response = client.post(
            f"/api/v1/sites/{published_site.id}/domain",
            json={"domain": "tacos.com"},
        )
        assert response.status_code == 401

    def test_connect_domain_requires_paid_plan(
        self,
        client: TestClient,
        db: Session,
        domain_tenant: dict[str, Any],
        published_site: Site,
    ) -> None:
        domain_tenant["foodcart"].subscription_status = "canceled"
        db.commit()

        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.post(
            f"/api/v1/sites/{published_site.id}/domain",
            json={"domain": "tacos.com"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 402

    def test_connect_domain_saves_normalized_domain(
        self, client: TestClient, domain_tenant: dict[str, Any], published_site: Site
    ) -> None:
        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.post(
            f"/api/v1/sites/{published_site.id}/domain",
            json={"domain": "https://www.Tacos.dev"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["custom_domain"] == "tacos.dev"
        assert data["domain_status"] == "active"

    def test_connect_domain_rejects_invalid_domain(
        self, client: TestClient, domain_tenant: dict[str, Any], published_site: Site
    ) -> None:
        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.post(
            f"/api/v1/sites/{published_site.id}/domain",
            json={"domain": "not a domain"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 422

    def test_connect_domain_rejects_duplicate(
        self, client: TestClient, db: Session, domain_tenant: dict[str, Any], published_site: Site
    ) -> None:
        other_site = Site(
            id=uuid.uuid4(),
            tenant_id=domain_tenant["tenant"].id,
            slug="other-bites",
            template_id="custom",
            publish_state="published",
        )
        other_site.custom_domain = "tacos.dev"
        db.add(other_site)
        db.commit()

        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.post(
            f"/api/v1/sites/{published_site.id}/domain",
            json={"domain": "tacos.dev"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 422

    def test_disconnect_domain_removes_domain(
        self, client: TestClient, db: Session, domain_tenant: dict[str, Any], published_site: Site
    ) -> None:
        published_site.custom_domain = "tacos.dev"
        published_site.domain_status = "active"
        db.commit()

        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.delete(
            f"/api/v1/sites/{published_site.id}/domain",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 204

        db.refresh(published_site)
        assert published_site.custom_domain is None
        assert published_site.domain_status is None


class TestPublicSiteByDomain:
    def test_lookup_published_site_by_domain(
        self, client: TestClient, db: Session, published_site: Site
    ) -> None:
        published_site.custom_domain = "tacos.dev"
        db.commit()

        response = client.get("/api/v1/public/sites/by-domain/tacos.dev")
        assert response.status_code == 200
        data = response.json()
        assert data["slug"] == "domain-bites"

    def test_lookup_unpublished_site_returns_404(
        self, client: TestClient, db: Session, published_site: Site
    ) -> None:
        published_site.custom_domain = "tacos.dev"
        published_site.publish_state = "draft"
        db.commit()

        response = client.get("/api/v1/public/sites/by-domain/tacos.dev")
        assert response.status_code == 404

    def test_lookup_unknown_domain_returns_404(self, client: TestClient) -> None:
        response = client.get("/api/v1/public/sites/by-domain/not-in-use.dev")
        assert response.status_code == 404


class TestDomainStatus:
    def test_status_reports_no_domain(
        self, client: TestClient, domain_tenant: dict[str, Any], published_site: Site
    ) -> None:
        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.get(
            f"/api/v1/sites/{published_site.id}/domain/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "none"

    def test_status_reports_active_domain(
        self, client: TestClient, db: Session, domain_tenant: dict[str, Any], published_site: Site
    ) -> None:
        published_site.custom_domain = "tacos.dev"
        published_site.domain_status = "active"
        db.commit()

        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.get(
            f"/api/v1/sites/{published_site.id}/domain/status",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["domain"] == "tacos.dev"
        assert data["status"] == "active"


class TestDomainPurchase:
    def test_check_domain_availability_requires_paid_plan(
        self,
        client: TestClient,
        db: Session,
        domain_tenant: dict[str, Any],
    ) -> None:
        domain_tenant["foodcart"].subscription_status = "canceled"
        db.commit()

        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.post(
            "/api/v1/domains/check",
            json=["tacos.test"],
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 402

    def test_check_domain_availability_stub(
        self, client: TestClient, domain_tenant: dict[str, Any]
    ) -> None:
        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.post(
            "/api/v1/domains/check",
            json=["tacos.test", "google.com"],
            headers={"Authorization": f"Bearer {token}"},
        )
        assert response.status_code == 200
        data = response.json()
        assert len(data["domains"]) == 2
        assert data["domains"][0]["registrable"] is True
        assert data["domains"][1]["registrable"] is False

    def test_purchase_domain_requires_paddle_config(
        self,
        client: TestClient,
        domain_tenant: dict[str, Any],
        published_site: Site,
    ) -> None:
        token = _make_token(domain_tenant["user"].id, domain_tenant["tenant"].id)
        response = client.post(
            f"/api/v1/domains/sites/{published_site.id}/purchase",
            json={"domain": "tacos.test"},
            headers={"Authorization": f"Bearer {token}"},
        )
        # Without PADDLE_DOMAIN_PRODUCT_ID the checkout cannot be created.
        assert response.status_code == 422


class TestDomainService:
    def test_normalize_domain_strips_protocol_and_www(self) -> None:
        from app.services.domain_service import normalize_domain

        assert normalize_domain("https://www.Example.com/path") == "example.com"
        assert normalize_domain("tacos.dev") == "tacos.dev"

    def test_validate_domain_format_rejects_reserved(self) -> None:
        from app.services.domain_service import DomainValidationError, validate_domain_format

        with pytest.raises(DomainValidationError):
            validate_domain_format("www")

    def test_validate_domain_format_accepts_valid(self) -> None:
        from app.services.domain_service import validate_domain_format

        assert validate_domain_format("tacos.dev") == "tacos.dev"
