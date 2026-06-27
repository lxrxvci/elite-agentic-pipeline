"""Structured security audit events.

Security-relevant actions are emitted through the ``app.audit`` logger so they
can be shipped to a SIEM or searched alongside application logs. Each event
includes an actor, action, resource, and outcome.
"""

from __future__ import annotations

import uuid
from typing import Any

from app.observability import get_logger

logger = get_logger("app.audit")


def _serialize(value: Any) -> Any:
    if isinstance(value, uuid.UUID):
        return str(value)
    return value


def log_security_event(
    event_type: str,
    actor_id: uuid.UUID | str | None,
    action: str,
    resource_type: str,
    resource_id: uuid.UUID | str | None = None,
    outcome: str = "success",
    details: dict[str, Any] | None = None,
) -> None:
    """Emit a structured security audit event.

    Args:
        event_type: High-level category, e.g. ``auth", "authorization",
            "billing", "domain", "data_mutation".
        actor_id: User or service that performed the action.
        action: Specific action verb, e.g. ``login", ``role_check_failed".
        resource_type: Kind of resource being acted on.
        resource_id: Optional identifier of the resource.
        outcome: ``success", ``failure", ``blocked".
        details: Additional context (sensitive values must not be included).
    """
    event = {
        "event_type": event_type,
        "action": action,
        "actor_id": _serialize(actor_id),
        "resource_type": resource_type,
        "resource_id": _serialize(resource_id),
        "outcome": outcome,
    }
    if details:
        event["details"] = {_serialize(k): _serialize(v) for k, v in details.items()}
    logger.info("security_event", **event)
