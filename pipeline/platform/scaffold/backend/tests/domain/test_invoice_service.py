"""Unit tests for the invoice domain service."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import pytest

from domain.entities import (
    Client,
    InvoiceStatus,
    Project,
    TimeEntry,
    TimeEntryStatus,
)
from domain.services.invoice import create_invoice_from_time_entries


def _make_client(rate: Decimal | None = Decimal("150.00")) -> Client:
    return Client(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        name="Acme",
        currency="USD",
        default_hourly_rate=rate,
    )


def _make_project(client: Client) -> Project:
    return Project(
        id=uuid.uuid4(),
        tenant_id=client.tenant_id,
        client_id=client.id,
        name="Website",
        rounding_minutes=15,
    )


def _make_time_entry(
    project: Project,
    description: str = "Work",
    duration_minutes: int = 60,
) -> TimeEntry:
    return TimeEntry(
        id=uuid.uuid4(),
        tenant_id=project.tenant_id,
        client_id=project.client_id,
        project_id=project.id,
        description=description,
        duration_minutes=duration_minutes,
        rounded_minutes=project.round_minutes(duration_minutes),
        status=TimeEntryStatus.UNBILLED,
    )


def test_create_invoice_from_single_time_entry() -> None:
    client = _make_client()
    project = _make_project(client)
    entry = _make_time_entry(project, duration_minutes=60)

    invoice = create_invoice_from_time_entries(
        tenant_id=client.tenant_id,
        client=client,
        time_entries=[entry],
        issue_date=date.today(),
        due_date=date.today() + timedelta(days=30),
    )

    assert invoice.tenant_id == client.tenant_id
    assert invoice.client_id == client.id
    assert invoice.status == InvoiceStatus.DRAFT
    assert len(invoice.line_items) == 1
    assert invoice.line_items[0].amount.amount == Decimal("150.00")
    assert invoice.total.amount == Decimal("150.00")
    assert entry.status == TimeEntryStatus.BILLED
    assert entry.invoice_id == invoice.id


def test_create_invoice_from_multiple_time_entries() -> None:
    client = _make_client()
    project = _make_project(client)
    entry1 = _make_time_entry(project, duration_minutes=60)
    entry2 = _make_time_entry(project, duration_minutes=30)

    invoice = create_invoice_from_time_entries(
        tenant_id=client.tenant_id,
        client=client,
        time_entries=[entry1, entry2],
        issue_date=date.today(),
        due_date=date.today() + timedelta(days=30),
    )

    assert len(invoice.line_items) == 2
    assert invoice.subtotal.amount == Decimal("225.00")
    assert invoice.total.amount == Decimal("225.00")
    assert entry1.status == TimeEntryStatus.BILLED
    assert entry2.status == TimeEntryStatus.BILLED


def test_create_invoice_requires_time_entries() -> None:
    client = _make_client()
    with pytest.raises(ValueError, match="At least one time entry is required"):
        create_invoice_from_time_entries(
            tenant_id=client.tenant_id,
            client=client,
            time_entries=[],
            issue_date=date.today(),
            due_date=date.today() + timedelta(days=30),
        )


def test_create_invoice_rejects_mismatched_tenant() -> None:
    client = _make_client()
    other_tenant_id = uuid.uuid4()
    project = _make_project(client)
    entry = _make_time_entry(project)

    with pytest.raises(ValueError, match="same tenant"):
        create_invoice_from_time_entries(
            tenant_id=other_tenant_id,
            client=client,
            time_entries=[entry],
            issue_date=date.today(),
            due_date=date.today() + timedelta(days=30),
        )


def test_create_invoice_rejects_mismatched_client() -> None:
    client = _make_client()
    other_client = _make_client()
    project = _make_project(client)
    entry = _make_time_entry(project)

    with pytest.raises(ValueError, match="invoice client"):
        create_invoice_from_time_entries(
            tenant_id=client.tenant_id,
            client=other_client,
            time_entries=[entry],
            issue_date=date.today(),
            due_date=date.today() + timedelta(days=30),
        )


def test_create_invoice_preserves_idempotency_key() -> None:
    client = _make_client()
    project = _make_project(client)
    entry = _make_time_entry(project)

    invoice = create_invoice_from_time_entries(
        tenant_id=client.tenant_id,
        client=client,
        time_entries=[entry],
        issue_date=date.today(),
        due_date=date.today() + timedelta(days=30),
        idempotency_key="invoice-key-1",
    )

    assert invoice.idempotency_key == "invoice-key-1"
