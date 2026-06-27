"""Add DB-level check constraints for enum-like columns.

Revision ID: 20250627_add_enum_check_constraints
Revises: 20250626b_add_custom_domain_fields
Create Date: 2026-06-27 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20250627_add_enum_check_constraints"
down_revision: str | None = "20250626b_add_custom_domain_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_CONSTRAINTS = [
    (
        "foodcart_tenants",
        "ck_foodcart_tenants_status",
        "status IN ('active', 'suspended', 'archived')",
    ),
    (
        "foodcart_tenants",
        "ck_foodcart_tenants_billing_status",
        "billing_status IN ('trial', 'active', 'past_due', 'canceled')",
    ),
    (
        "foodcart_tenants",
        "ck_foodcart_tenants_billing_interval",
        "billing_interval IS NULL OR billing_interval IN ('month', 'year')",
    ),
    (
        "foodcart_tenants",
        "ck_foodcart_tenants_subscription_status",
        "subscription_status IS NULL OR subscription_status IN "
        "('trialing', 'active', 'past_due', 'canceled', 'paused')",
    ),
    (
        "sites",
        "ck_sites_publish_state",
        "publish_state IN ('draft', 'published')",
    ),
    (
        "sites",
        "ck_sites_template_id",
        "template_id IN ('banhmi', 'real-indian', 'mis-abuelos', 'custom')",
    ),
    (
        "sites",
        "ck_sites_domain_status",
        "domain_status IS NULL OR domain_status IN ('pending', 'active', 'expired', 'error')",
    ),
    (
        "sites",
        "ck_sites_domain_provider",
        "domain_provider IS NULL OR domain_provider IN ('external', 'cloudflare', 'namecheap')",
    ),
    (
        "content_blocks",
        "ck_content_blocks_block_type",
        "block_type IN ('hero', 'story', 'menu', 'locations', "
        "'catering', 'contact', 'order_links', 'footer')",
    ),
    (
        "revisions",
        "ck_revisions_source",
        "source IN ('manual', 'ai', 'ingestion', 'revert')",
    ),
    (
        "ingestion_jobs",
        "ck_ingestion_jobs_source_type",
        "source_type IN ('google_business', 'yelp', 'menu_url', 'website', 'social_links')",
    ),
    (
        "ingestion_jobs",
        "ck_ingestion_jobs_status",
        "status IN ('pending', 'running', 'completed', 'failed')",
    ),
    (
        "ai_requests",
        "ck_ai_requests_status",
        "status IN ('proposed', 'applied', 'rejected', 'failed')",
    ),
]


def upgrade() -> None:
    for table, name, condition in _CONSTRAINTS:
        op.execute(
            sa.text(
                f"""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints
                        WHERE constraint_name = '{name}'
                          AND table_name = '{table}'
                    ) THEN
                        ALTER TABLE {table}
                        ADD CONSTRAINT {name}
                        CHECK ({condition});
                    END IF;
                END $$;
                """
            )
        )


def downgrade() -> None:
    for table, name, _condition in reversed(_CONSTRAINTS):
        op.execute(
            sa.text(
                f"""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM information_schema.table_constraints
                        WHERE constraint_name = '{name}'
                          AND table_name = '{table}'
                    ) THEN
                        ALTER TABLE {table}
                        DROP CONSTRAINT {name};
                    END IF;
                END $$;
                """
            )
        )
