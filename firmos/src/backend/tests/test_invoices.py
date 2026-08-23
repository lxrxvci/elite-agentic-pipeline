"""Invoice API tests."""

from datetime import date, timedelta

from fastapi.testclient import TestClient


def test_create_invoice_from_time_entries(
    client: TestClient, seeded_user: dict, seeded_project
) -> None:
    headers = seeded_user["headers"]

    te_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Design work",
            "duration_minutes": 60,
        },
        headers=headers,
    )
    time_entry_id = te_response.json()["id"]

    response = client.post(
        "/api/v1/invoices",
        json={
            "client_id": str(seeded_project.client_id),
            "time_entry_ids": [time_entry_id],
            "issue_date": str(date.today()),
            "due_date": str(date.today() + timedelta(days=30)),
        },
        headers=headers,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["status"] == "draft"
    assert len(data["line_items"]) == 1
    assert data["total"]["amount"] == "150.00"


def test_create_invoice_is_idempotent(
    client: TestClient, seeded_user: dict, seeded_project
) -> None:
    headers = seeded_user["headers"]

    te_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Idempotent work",
            "duration_minutes": 60,
        },
        headers=headers,
    )
    time_entry_id = te_response.json()["id"]

    payload = {
        "client_id": str(seeded_project.client_id),
        "time_entry_ids": [time_entry_id],
        "issue_date": str(date.today()),
        "due_date": str(date.today() + timedelta(days=30)),
        "idempotency_key": "unique-key-123",
    }

    response1 = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert response1.status_code == 201
    invoice_id = response1.json()["id"]

    # Second request with the same idempotency key should return the same invoice.
    response2 = client.post("/api/v1/invoices", json=payload, headers=headers)
    assert response2.status_code == 201
    assert response2.json()["id"] == invoice_id

    # A different key should create a new invoice (need a fresh time entry).
    te_response2 = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Different work",
            "duration_minutes": 60,
        },
        headers=headers,
    )
    payload2 = {
        **payload,
        "time_entry_ids": [te_response2.json()["id"]],
        "idempotency_key": "unique-key-456",
    }
    response3 = client.post("/api/v1/invoices", json=payload2, headers=headers)
    assert response3.status_code == 201
    assert response3.json()["id"] != invoice_id


def test_mark_invoice_paid(client: TestClient, seeded_user: dict, seeded_project) -> None:
    headers = seeded_user["headers"]

    te_response = client.post(
        "/api/v1/time-entries",
        json={
            "client_id": str(seeded_project.client_id),
            "project_id": str(seeded_project.id),
            "description": "Dev work",
            "duration_minutes": 60,
        },
        headers=headers,
    )
    time_entry_id = te_response.json()["id"]

    invoice_response = client.post(
        "/api/v1/invoices",
        json={
            "client_id": str(seeded_project.client_id),
            "time_entry_ids": [time_entry_id],
            "issue_date": str(date.today()),
            "due_date": str(date.today() + timedelta(days=30)),
        },
        headers=headers,
    )
    invoice_id = invoice_response.json()["id"]

    paid_response = client.post(
        f"/api/v1/invoices/{invoice_id}/mark-paid",
        json={"payment_method": "bank_transfer"},
        headers=headers,
    )
    assert paid_response.status_code == 200
    assert paid_response.json()["status"] == "paid"
