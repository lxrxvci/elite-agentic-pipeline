"""Role-based access control tests."""

from __future__ import annotations

import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.dependencies import create_access_token
from infrastructure.models import User


def _token_for(user: User) -> str:
    return create_access_token(
        user_id=user.id,
        email=user.email,
        name=user.name,
        tenant_id=user.tenant_id,
    )


@pytest.fixture()
def member_user(db: Session, seeded_user: dict):
    user = User(
        id=uuid.uuid4(),
        tenant_id=seeded_user["tenant"].id,
        email="member@example.com",
        name="Member User",
        role="member",
    )
    db.add(user)
    db.commit()
    user.token = _token_for(user)  # type: ignore[attr-defined]
    return user


def test_owner_can_create_client(client: TestClient, seeded_user: dict) -> None:
    response = client.post(
        "/api/v1/clients",
        json={"name": "Owner Client", "currency": "USD"},
        headers=seeded_user["headers"],
    )
    assert response.status_code == 201


def test_member_cannot_create_client(client: TestClient, member_user: User) -> None:
    response = client.post(
        "/api/v1/clients",
        json={"name": "Member Client", "currency": "USD"},
        headers={"Authorization": f"Bearer {member_user.token}"},  # type: ignore[attr-defined]
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


def test_member_can_list_clients(client: TestClient, member_user: User) -> None:
    response = client.get(
        "/api/v1/clients",
        headers={"Authorization": f"Bearer {member_user.token}"},  # type: ignore[attr-defined]
    )
    assert response.status_code == 200


def test_member_cannot_create_project(
    client: TestClient, seeded_client, member_user: User
) -> None:
    response = client.post(
        "/api/v1/projects",
        json={
            "client_id": str(seeded_client.id),
            "name": "Member Project",
            "rounding_minutes": 15,
        },
        headers={"Authorization": f"Bearer {member_user.token}"},  # type: ignore[attr-defined]
    )
    assert response.status_code == 403


def test_member_cannot_create_time_entry(
    client: TestClient, seeded_project, member_user: User
) -> None:
    response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Member work",
            "duration_minutes": 60,
        },
        headers={"Authorization": f"Bearer {member_user.token}"},  # type: ignore[attr-defined]
    )
    assert response.status_code == 403


def test_member_cannot_create_invoice(
    client: TestClient, seeded_project, member_user: User
) -> None:
    response = client.post(
        "/api/v1/invoices",
        json={
            "client_id": str(seeded_project.client_id),
            "time_entry_ids": [],
            "issue_date": "2026-06-15",
            "due_date": "2026-06-30",
        },
        headers={"Authorization": f"Bearer {member_user.token}"},  # type: ignore[attr-defined]
    )
    assert response.status_code == 403
