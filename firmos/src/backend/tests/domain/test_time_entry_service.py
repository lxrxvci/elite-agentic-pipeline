"""Unit tests for the time entry domain service."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

import pytest

from domain.entities import Project, Tenant, TimeEntryStatus
from domain.services.time_entry import create_time_entry


def _make_tenant() -> Tenant:
    return Tenant(
        id=uuid.uuid4(),
        name="Tenant",
        default_currency="USD",
        default_hourly_rate=Decimal("150.00"),
    )


def _make_project(rounding_minutes: int = 15) -> Project:
    tenant_id = uuid.uuid4()
    return Project(
        id=uuid.uuid4(),
        tenant_id=tenant_id,
        client_id=uuid.uuid4(),
        name="Project",
        rounding_minutes=rounding_minutes,
    )


def test_create_time_entry_from_duration() -> None:
    tenant = _make_tenant()
    project = _make_project()
    entry = create_time_entry(
        tenant=tenant,
        project=project,
        description="Design work",
        duration_minutes=20,
        started_at=None,
        ended_at=None,
    )

    assert entry.tenant_id == tenant.id
    assert entry.project_id == project.id
    assert entry.client_id == project.client_id
    assert entry.description == "Design work"
    assert entry.duration_minutes == 20
    assert entry.rounded_minutes == 15
    assert entry.status == TimeEntryStatus.UNBILLED


def test_create_time_entry_from_timestamps() -> None:
    tenant = _make_tenant()
    project = _make_project()
    started_at = datetime.now(UTC)
    ended_at = started_at + timedelta(minutes=90)

    entry = create_time_entry(
        tenant=tenant,
        project=project,
        description="Dev work",
        duration_minutes=None,
        started_at=started_at,
        ended_at=ended_at,
    )

    assert entry.duration_minutes == 90
    assert entry.rounded_minutes == 90
    assert entry.started_at == started_at
    assert entry.ended_at == ended_at


def test_create_time_entry_requires_duration_or_timestamps() -> None:
    tenant = _make_tenant()
    project = _make_project()
    with pytest.raises(ValueError, match="Either duration_minutes or both timestamps"):
        create_time_entry(
            tenant=tenant,
            project=project,
            description="Incomplete",
            duration_minutes=None,
            started_at=None,
            ended_at=None,
        )


def test_create_time_entry_rounding_honors_project_step() -> None:
    tenant = _make_tenant()
    project = _make_project(rounding_minutes=30)
    entry = create_time_entry(
        tenant=tenant,
        project=project,
        description="Meeting",
        duration_minutes=25,
        started_at=None,
        ended_at=None,
    )

    assert entry.rounded_minutes == 30
