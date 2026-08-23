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


def _headers_for(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token_for(user)}"}


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
    return user


@pytest.fixture()
def other_member_user(db: Session, seeded_user: dict):
    user = User(
        id=uuid.uuid4(),
        tenant_id=seeded_user["tenant"].id,
        email="other-member@example.com",
        name="Other Member",
        role="member",
    )
    db.add(user)
    db.commit()
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
        headers=_headers_for(member_user),
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Insufficient permissions"


def test_member_can_list_clients(client: TestClient, member_user: User) -> None:
    response = client.get("/api/v1/clients", headers=_headers_for(member_user))
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
        headers=_headers_for(member_user),
    )
    assert response.status_code == 403


def test_member_can_create_and_update_own_time_entry(
    client: TestClient, seeded_project, member_user: User
) -> None:
    create_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Member work",
            "duration_minutes": 60,
        },
        headers=_headers_for(member_user),
    )
    assert create_response.status_code == 201
    data = create_response.json()
    assert data["description"] == "Member work"
    time_entry_id = data["id"]

    update_response = client.patch(
        f"/api/v1/time-entries/{time_entry_id}",
        json={"description": "Updated member work"},
        headers=_headers_for(member_user),
    )
    assert update_response.status_code == 200
    assert update_response.json()["description"] == "Updated member work"


def test_member_cannot_update_other_member_time_entry(
    client: TestClient, seeded_project, member_user: User, other_member_user: User
) -> None:
    create_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Private work",
            "duration_minutes": 60,
        },
        headers=_headers_for(member_user),
    )
    assert create_response.status_code == 201
    time_entry_id = create_response.json()["id"]

    response = client.patch(
        f"/api/v1/time-entries/{time_entry_id}",
        json={"description": "Hacked"},
        headers=_headers_for(other_member_user),
    )
    assert response.status_code == 403


def test_owner_can_update_any_time_entry(
    client: TestClient, seeded_user: dict, seeded_project, member_user: User
) -> None:
    create_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Member work",
            "duration_minutes": 60,
        },
        headers=_headers_for(member_user),
    )
    assert create_response.status_code == 201
    time_entry_id = create_response.json()["id"]

    response = client.patch(
        f"/api/v1/time-entries/{time_entry_id}",
        json={"description": "Owner updated"},
        headers=seeded_user["headers"],
    )
    assert response.status_code == 200
    assert response.json()["description"] == "Owner updated"


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
        headers=_headers_for(member_user),
    )
    assert response.status_code == 403
