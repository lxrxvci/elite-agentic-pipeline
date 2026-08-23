"""Cross-service idempotency-key storage for mutation endpoints.

When a client supplies an ``Idempotency-Key`` header (mirrored in the request
body as ``idempotency_key``), the response is persisted for the scope/tenant/key
triple so that retries return the same result without side effects.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from fastapi import Request
from pydantic import BaseModel
from sqlalchemy import JSON, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, Session, mapped_column

from infrastructure.database import Base


def get_idempotency_key(request: Request, payload_key: str | None) -> str | None:
    """Return the ``Idempotency-Key`` header value, falling back to the body key."""
    return request.headers.get("Idempotency-Key") or payload_key


def _utc_now() -> datetime:
    return datetime.now(UTC)


class IdempotencyRequest(Base):
    __tablename__ = "idempotency_requests"
    __table_args__ = (
        UniqueConstraint("tenant_id", "scope", "idempotency_key"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    tenant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("tenants.id"), nullable=False, index=True
    )
    scope: Mapped[str] = mapped_column(String(100), nullable=False)
    idempotency_key: Mapped[str] = mapped_column(String(255), nullable=False)
    response_json: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=_utc_now
    )


class IdempotencyRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def get_response(
        self, tenant_id: uuid.UUID, scope: str, idempotency_key: str
    ) -> dict[str, Any] | None:
        orm = (
            self.session.query(IdempotencyRequest)
            .filter(IdempotencyRequest.tenant_id == tenant_id)
            .filter(IdempotencyRequest.scope == scope)
            .filter(IdempotencyRequest.idempotency_key == idempotency_key)
            .first()
        )
        return orm.response_json if orm else None

    def record_response(
        self,
        tenant_id: uuid.UUID,
        scope: str,
        idempotency_key: str,
        response: BaseModel,
    ) -> None:
        orm = IdempotencyRequest(
            tenant_id=tenant_id,
            scope=scope,
            idempotency_key=idempotency_key,
            response_json=response.model_dump(mode="json"),
        )
        self.session.add(orm)
        self.session.flush()
