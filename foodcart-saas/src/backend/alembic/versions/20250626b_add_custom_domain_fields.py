"""Add custom domain lifecycle fields to sites.

Revision ID: 20250626b_add_custom_domain_fields
Revises: 20250626a_add_paddle_billing_fields
Create Date: 2026-06-26 00:00:00.000001

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20250626b_add_custom_domain_fields"
down_revision: str | None = "20250626a_add_paddle_billing_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "sites",
        sa.Column("domain_status", sa.String(length=20), nullable=True),
    )
    op.add_column(
        "sites",
        sa.Column("domain_provider", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "sites",
        sa.Column("domain_registered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "sites",
        sa.Column("domain_expires_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "sites",
        sa.Column("domain_paddle_transaction_id", sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sites", "domain_paddle_transaction_id")
    op.drop_column("sites", "domain_expires_at")
    op.drop_column("sites", "domain_registered_at")
    op.drop_column("sites", "domain_provider")
    op.drop_column("sites", "domain_status")
