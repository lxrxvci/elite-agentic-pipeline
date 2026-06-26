"""Add Paddle billing and custom domain fields.

Revision ID: 20250626_add_paddle_billing_and_domain_fields
Revises: 20250625_add_site_brand_colors
Create Date: 2026-06-26 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20250626_add_paddle_billing_and_domain_fields"
down_revision: Union[str, None] = "20250625_add_site_brand_colors"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Paddle Billing columns on foodcart_tenants
    op.add_column(
        "foodcart_tenants",
        sa.Column("paddle_customer_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column("paddle_subscription_id", sa.String(length=255), nullable=True),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column("plan", sa.String(length=50), nullable=False, server_default="base"),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column("billing_interval", sa.String(length=10), nullable=True),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column("subscription_status", sa.String(length=30), nullable=True),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column(
            "subscription_current_period_start", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column(
            "subscription_current_period_end", sa.DateTime(timezone=True), nullable=True
        ),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "foodcart_tenants",
        sa.Column("canceled_at", sa.DateTime(timezone=True), nullable=True),
    )

    op.create_index(
        op.f("ix_foodcart_tenants_paddle_customer_id"),
        "foodcart_tenants",
        ["paddle_customer_id"],
        unique=True,
    )
    op.create_index(
        op.f("ix_foodcart_tenants_paddle_subscription_id"),
        "foodcart_tenants",
        ["paddle_subscription_id"],
        unique=True,
    )

    # Custom domain lifecycle columns on sites
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

    op.drop_index(
        op.f("ix_foodcart_tenants_paddle_subscription_id"),
        table_name="foodcart_tenants",
    )
    op.drop_index(
        op.f("ix_foodcart_tenants_paddle_customer_id"),
        table_name="foodcart_tenants",
    )
    op.drop_column("foodcart_tenants", "canceled_at")
    op.drop_column("foodcart_tenants", "trial_ends_at")
    op.drop_column("foodcart_tenants", "subscription_current_period_end")
    op.drop_column("foodcart_tenants", "subscription_current_period_start")
    op.drop_column("foodcart_tenants", "subscription_status")
    op.drop_column("foodcart_tenants", "billing_interval")
    op.drop_column("foodcart_tenants", "plan")
    op.drop_column("foodcart_tenants", "paddle_subscription_id")
    op.drop_column("foodcart_tenants", "paddle_customer_id")
