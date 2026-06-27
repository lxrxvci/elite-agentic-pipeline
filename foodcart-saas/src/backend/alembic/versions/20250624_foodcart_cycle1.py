"""Add Foodcart SaaS Cycle 1 tables.

Revision ID: 20250624_foodcart_cycle1
Revises: 20250623_created_by
Create Date: 2026-06-24 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20250624_foodcart_cycle1"
down_revision: str | None = "20250623_created_by"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "foodcart_tenants",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=63), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("billing_status", sa.String(length=20), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("slug"),
        sa.CheckConstraint(
            "status IN ('active', 'suspended', 'archived')",
            name="ck_foodcart_tenants_status",
        ),
        sa.CheckConstraint(
            "billing_status IN ('trial', 'active', 'past_due', 'canceled')",
            name="ck_foodcart_tenants_billing_status",
        ),
    )
    op.create_index(
        op.f("ix_foodcart_tenants_owner_user_id"), "foodcart_tenants", ["owner_user_id"], unique=False
    )
    op.create_index(
        op.f("ix_foodcart_tenants_slug"), "foodcart_tenants", ["slug"], unique=True
    )

    op.create_table(
        "sites",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("slug", sa.String(length=63), nullable=False),
        sa.Column("template_id", sa.String(length=50), nullable=False),
        sa.Column("publish_state", sa.String(length=20), nullable=False),
        sa.Column("seo", sa.JSON(), nullable=True),
        sa.Column("custom_domain", sa.String(length=255), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("custom_domain"),
        sa.UniqueConstraint("slug"),
        sa.CheckConstraint(
            "publish_state IN ('draft', 'published')",
            name="ck_sites_publish_state",
        ),
        sa.CheckConstraint(
            "template_id IN ('banhmi', 'real-indian', 'mis-abuelos', 'custom')",
            name="ck_sites_template_id",
        ),
    )
    op.create_index(op.f("ix_sites_slug"), "sites", ["slug"], unique=True)
    op.create_index(op.f("ix_sites_tenant_id"), "sites", ["tenant_id"], unique=False)

    op.create_table(
        "content_blocks",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("block_type", sa.String(length=50), nullable=False),
        sa.Column("schema_version", sa.String(length=20), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "block_type IN ('hero', 'story', 'menu', 'locations', "
            "'catering', 'contact', 'order_links', 'footer')",
            name="ck_content_blocks_block_type",
        ),
    )
    op.create_index(
        op.f("ix_content_blocks_block_type"), "content_blocks", ["block_type"], unique=False
    )
    op.create_index(
        op.f("ix_content_blocks_site_id"), "content_blocks", ["site_id"], unique=False
    )
    op.create_index(
        op.f("ix_content_blocks_tenant_id"), "content_blocks", ["tenant_id"], unique=False
    )

    op.create_table(
        "revisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("triggered_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source", sa.String(length=20), nullable=False),
        sa.Column("ai_request_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("snapshot", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["ai_request_id"], ["ai_requests.id"], use_alter=True),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["triggered_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "source IN ('manual', 'ai', 'ingestion', 'revert')",
            name="ck_revisions_source",
        ),
    )
    op.create_index(op.f("ix_revisions_site_id"), "revisions", ["site_id"], unique=False)
    op.create_index(op.f("ix_revisions_tenant_id"), "revisions", ["tenant_id"], unique=False)

    op.create_table(
        "ingestion_jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", sa.String(length=50), nullable=False),
        sa.Column("source_url", sa.String(length=2048), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("normalized_data", sa.JSON(), nullable=True),
        sa.Column("errors", sa.JSON(), nullable=False),
        sa.Column("raw_payload", sa.JSON(), nullable=True),
        sa.Column("proposed_blocks", sa.JSON(), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "source_type IN ('google_business', 'yelp', 'menu_url', 'website', 'social_links')",
            name="ck_ingestion_jobs_source_type",
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'running', 'completed', 'failed')",
            name="ck_ingestion_jobs_status",
        ),
    )
    op.create_index(
        op.f("ix_ingestion_jobs_site_id"), "ingestion_jobs", ["site_id"], unique=False
    )
    op.create_index(
        op.f("ix_ingestion_jobs_tenant_id"), "ingestion_jobs", ["tenant_id"], unique=False
    )

    op.create_table(
        "ai_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("tenant_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("site_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("prompt_hash", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("proposed_patch", sa.JSON(), nullable=False),
        sa.Column("applied_revision_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.ForeignKeyConstraint(
            ["applied_revision_id"], ["revisions.id"], use_alter=True
        ),
        sa.ForeignKeyConstraint(["site_id"], ["sites.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tenant_id"], ["tenants.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('proposed', 'applied', 'rejected', 'failed')",
            name="ck_ai_requests_status",
        ),
    )
    op.create_index(
        op.f("ix_ai_requests_prompt_hash"), "ai_requests", ["prompt_hash"], unique=False
    )
    op.create_index(
        op.f("ix_ai_requests_site_id"), "ai_requests", ["site_id"], unique=False
    )
    op.create_index(
        op.f("ix_ai_requests_tenant_id"), "ai_requests", ["tenant_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_revisions_tenant_id"), table_name="revisions")
    op.drop_index(op.f("ix_revisions_site_id"), table_name="revisions")
    op.drop_table("revisions")

    op.drop_index(op.f("ix_ai_requests_tenant_id"), table_name="ai_requests")
    op.drop_index(op.f("ix_ai_requests_site_id"), table_name="ai_requests")
    op.drop_index(op.f("ix_ai_requests_prompt_hash"), table_name="ai_requests")
    op.drop_table("ai_requests")

    op.drop_index(op.f("ix_ingestion_jobs_tenant_id"), table_name="ingestion_jobs")
    op.drop_index(op.f("ix_ingestion_jobs_site_id"), table_name="ingestion_jobs")
    op.drop_table("ingestion_jobs")

    op.drop_index(op.f("ix_content_blocks_tenant_id"), table_name="content_blocks")
    op.drop_index(op.f("ix_content_blocks_site_id"), table_name="content_blocks")
    op.drop_index(op.f("ix_content_blocks_block_type"), table_name="content_blocks")
    op.drop_table("content_blocks")

    op.drop_index(op.f("ix_sites_tenant_id"), table_name="sites")
    op.drop_index(op.f("ix_sites_slug"), table_name="sites")
    op.drop_table("sites")

    op.drop_index(op.f("ix_foodcart_tenants_slug"), table_name="foodcart_tenants")
    op.drop_index(op.f("ix_foodcart_tenants_owner_user_id"), table_name="foodcart_tenants")
    op.drop_table("foodcart_tenants")
