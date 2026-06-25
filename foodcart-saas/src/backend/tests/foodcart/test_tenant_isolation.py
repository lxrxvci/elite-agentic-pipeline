"""Cross-tenant isolation regression tests."""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.dependencies import create_access_token
from infrastructure.models import Tenant, User


def _other_user(db: Session):
    tenant = Tenant(name="Other Tenant")
    db.add(tenant)
    db.flush()
    user = User(
        id=uuid.uuid4(),
        tenant_id=tenant.id,
        email="other@example.com",
        name="Other User",
        role="owner",
    )
    db.add(user)
    db.commit()
    token = create_access_token(
        user_id=user.id,
        email=user.email,
        name=user.name,
        tenant_id=user.tenant_id,
    )
    return {
        "user": user,
        "tenant": tenant,
        "token": token,
        "headers": {"Authorization": f"Bearer {token}"},
    }


def test_cannot_view_other_tenant_site(client: TestClient, onboarded, db: Session):
    other = _other_user(db)
    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}", headers=other["headers"]
    )
    assert response.status_code == 404


def test_cannot_view_other_tenant_content(client: TestClient, onboarded, db: Session):
    other = _other_user(db)
    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content", headers=other["headers"]
    )
    assert response.status_code == 404


def test_cannot_delete_other_tenant_block(client: TestClient, onboarded, db: Session):
    other = _other_user(db)
    blocks = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/content",
        headers=onboarded["user"]["headers"],
    ).json()["blocks"]
    hero = next(b for b in blocks if b["block_type"] == "hero")
    response = client.delete(
        f"/api/v1/sites/{onboarded['site']['id']}/content/blocks/{hero['id']}",
        headers=other["headers"],
    )
    assert response.status_code == 404


def test_cannot_propose_ai_for_other_tenant(client: TestClient, onboarded, db: Session):
    other = _other_user(db)
    response = client.post(
        f"/api/v1/sites/{onboarded['site']['id']}/ai/propose",
        json={"prompt": "Change hero headline"},
        headers=other["headers"],
    )
    assert response.status_code == 404


def test_cannot_list_other_tenant_revisions(client: TestClient, onboarded, db: Session):
    other = _other_user(db)
    response = client.get(
        f"/api/v1/sites/{onboarded['site']['id']}/revisions",
        headers=other["headers"],
    )
    assert response.status_code == 404
