"""Idempotency-key behavior across mutation endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient


def test_create_client_is_idempotent(client: TestClient, seeded_user) -> None:
    payload = {
        "name": "Idempotent Client",
        "email": "idempotent@example.com",
        "currency": "USD",
        "idempotency_key": "client-key-123",
    }

    first = client.post("/api/v1/clients", json=payload, headers=seeded_user["headers"])
    assert first.status_code == 201

    second = client.post("/api/v1/clients", json=payload, headers=seeded_user["headers"])
    assert second.status_code == 201

    assert first.json()["id"] == second.json()["id"]


def test_create_project_is_idempotent(client: TestClient, seeded_user, seeded_client) -> None:
    payload = {
        "client_id": str(seeded_client.id),
        "name": "Idempotent Project",
        "rounding_minutes": 15,
        "idempotency_key": "project-key-123",
    }

    first = client.post("/api/v1/projects", json=payload, headers=seeded_user["headers"])
    assert first.status_code == 201

    second = client.post("/api/v1/projects", json=payload, headers=seeded_user["headers"])
    assert second.status_code == 201

    assert first.json()["id"] == second.json()["id"]


def test_create_time_entry_is_idempotent(client: TestClient, seeded_user, seeded_project) -> None:
    payload = {
        "client_id": str(seeded_project.client_id),
        "project_id": str(seeded_project.id),
        "description": "Idempotent work",
        "duration_minutes": 60,
        "idempotency_key": "time-entry-key-123",
    }

    first = client.post("/api/v1/time-entries", json=payload, headers=seeded_user["headers"])
    assert first.status_code == 201

    second = client.post("/api/v1/time-entries", json=payload, headers=seeded_user["headers"])
    assert second.status_code == 201

    assert first.json()["id"] == second.json()["id"]


def test_mark_invoice_paid_is_idempotent(client: TestClient, seeded_user, seeded_project) -> None:
    # Create a time entry to include in the invoice.
    time_entry_payload = {
        "client_id": str(seeded_project.client_id),
        "project_id": str(seeded_project.id),
        "description": "Invoiceable work",
        "duration_minutes": 60,
    }
    time_entry_response = client.post(
        "/api/v1/time-entries", json=time_entry_payload, headers=seeded_user["headers"]
    )
    assert time_entry_response.status_code == 201
    time_entry_id = time_entry_response.json()["id"]

    # Create an invoice to pay.
    invoice_payload = {
        "client_id": str(seeded_project.client_id),
        "time_entry_ids": [time_entry_id],
        "issue_date": "2026-06-15",
        "due_date": "2026-06-30",
        "idempotency_key": "invoice-create-key-123",
    }
    invoice_response = client.post(
        "/api/v1/invoices", json=invoice_payload, headers=seeded_user["headers"]
    )
    assert invoice_response.status_code == 201
    invoice_id = invoice_response.json()["id"]

    payload = {
        "payment_method": "bank_transfer",
        "idempotency_key": "mark-paid-key-123",
    }

    first = client.post(
        f"/api/v1/invoices/{invoice_id}/mark-paid",
        json=payload,
        headers=seeded_user["headers"],
    )
    assert first.status_code == 200

    second = client.post(
        f"/api/v1/invoices/{invoice_id}/mark-paid",
        json=payload,
        headers=seeded_user["headers"],
    )
    # Replaying the same idempotency key returns the already-paid invoice.
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["status"] == "paid"



def test_idempotency_header_takes_precedence(
    client: TestClient, seeded_user, seeded_project
) -> None:
    headers = {**seeded_user["headers"], "Idempotency-Key": "header-key-123"}
    payload = {
        "client_id": str(seeded_project.client_id),
        "project_id": str(seeded_project.id),
        "description": "Header keyed work",
        "duration_minutes": 60,
    }

    first = client.post("/api/v1/time-entries", json=payload, headers=headers)
    assert first.status_code == 201

    second = client.post("/api/v1/time-entries", json=payload, headers=headers)
    assert second.status_code == 201
    assert first.json()["id"] == second.json()["id"]


def test_update_time_entry_is_idempotent(client: TestClient, seeded_user, seeded_project) -> None:
    create_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Update idempotent",
            "duration_minutes": 60,
        },
        headers=seeded_user["headers"],
    )
    assert create_response.status_code == 201
    time_entry_id = create_response.json()["id"]

    payload = {"description": "Updated", "idempotency_key": "update-key-123"}
    first = client.patch(
        f"/api/v1/time-entries/{time_entry_id}",
        json=payload,
        headers=seeded_user["headers"],
    )
    assert first.status_code == 200

    second = client.patch(
        f"/api/v1/time-entries/{time_entry_id}",
        json=payload,
        headers=seeded_user["headers"],
    )
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert second.json()["description"] == "Updated"
