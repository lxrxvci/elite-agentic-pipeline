"""Tests for timezone-aware open/closed computation."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from domain.services.foodcart import OpenClosedStatus, compute_location_status


@pytest.fixture()
def hours():
    return {
        "monday": "11:00-22:00",
        "tuesday": "11:00-22:00",
        "wednesday": "11:00-22:00",
        "thursday": "11:00-22:00",
        "friday": "11:00-23:00",
        "saturday": "11:00-23:00",
        "sunday": "12:00-20:00",
    }


def test_open_during_hours(hours):
    ref = datetime(2026, 6, 24, 15, 0, 0, tzinfo=UTC)  # Wednesday 11am-10pm EDT
    status = compute_location_status(hours, "America/New_York", ref)
    assert status.status == OpenClosedStatus.OPEN
    assert "Open now" in status.message


def test_closed_before_opening(hours):
    ref = datetime(2026, 6, 24, 14, 0, 0, tzinfo=UTC)  # Wednesday 10am EDT
    status = compute_location_status(hours, "America/New_York", ref)
    assert status.status == OpenClosedStatus.CLOSED
    assert "opens today at" in status.message


def test_closed_after_closing(hours):
    ref = datetime(2026, 6, 25, 3, 0, 0, tzinfo=UTC)  # Wednesday 11pm EDT
    status = compute_location_status(hours, "America/New_York", ref)
    assert status.status == OpenClosedStatus.CLOSED
    assert "opens" in status.message


def test_invalid_timezone():
    status = compute_location_status({}, "Mars/Phobos", datetime.now(UTC))
    assert status.status == OpenClosedStatus.CLOSED
    assert "Invalid timezone" in status.message


def test_overnight_hours():
    overnight = {"wednesday": "22:00-02:00"}
    # 03:00 UTC June 25 == Wednesday 11:00 PM EDT, within 10pm-2am window.
    ref = datetime(2026, 6, 25, 3, 0, 0, tzinfo=UTC)
    status = compute_location_status(overnight, "America/New_York", ref)
    assert status.status == OpenClosedStatus.OPEN
