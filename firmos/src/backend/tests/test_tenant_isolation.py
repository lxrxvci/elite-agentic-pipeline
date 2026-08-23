"""Tenant isolation tests."""

import uuid

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.dependencies import create_access_token
from infrastructure.models import Tenant, User


def _token_for(user: User) -> str:
    return create_access_token(
        user_id=user.id,
        email=user.email,
        name=user.name,
        tenant_id=user.tenant_id,
    )


def _other_user(db: Session):
    other_tenant = Tenant(name="Other Tenant", default_currency="USD")
    db.add(other_tenant)
    db.flush()

    other_user = User(
        id=uuid.uuid4(),
        tenant_id=other_tenant.id,
        email="other@example.com",
        name="Other User",
        role="owner",
    )
    db.add(other_user)
    db.flush()
    return other_user, other_tenant


def test_user_cannot_read_other_tenant_client(
    client: TestClient, db: Session, seeded_user: dict, seeded_client
) -> None:
    other_user, _other_tenant = _other_user(db)
    db.commit()

    response = client.get(
        f"/api/v1/clients/{seeded_client.id}",
        headers={"Authorization": f"Bearer {_token_for(other_user)}"},
    )
    assert response.status_code == 404


def test_user_cannot_update_other_tenant_time_entry(
    client: TestClient, db: Session, seeded_user: dict, seeded_project
) -> None:
    # Create a time entry in the seeded tenant.
    te_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Seeded work",
            "duration_minutes": 60,
        },
        headers=seeded_user["headers"],
    )
    assert te_response.status_code == 201
    time_entry_id = te_response.json()["id"]

    other_user, _other_tenant = _other_user(db)
    db.commit()

    response = client.patch(
        f"/api/v1/time-entries/{time_entry_id}",
        json={"description": "Hacked"},
        headers={"Authorization": f"Bearer {_token_for(other_user)}"},
    )
    assert response.status_code == 404
