"""Add uploaded_images table and extend ingestion source types.

Revision ID: 20250628_add_uploaded_images
Revises: 20250627_add_enum_check_constraints
Create Date: 2026-06-28 00:00:00.000000

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20250628_add_uploaded_images"
down_revision: str | None = "20250627_add_enum_check_constraints"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "uploaded_images",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column(
            "tenant_id",
            sa.UUID(),
            sa.ForeignKey("tenants.id"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "site_id",
            sa.UUID(),
            sa.ForeignKey("sites.id", ondelete="SET NULL"),
            nullable=True,
            index=True,
        ),
        sa.Column("storage_key", sa.String(512), nullable=False, unique=True),
        sa.Column("public_url", sa.String(2048), nullable=True),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("size_bytes", sa.Integer(), nullable=False, default=0),
        sa.Column("status", sa.String(20), nullable=False, default="uploaded"),
        sa.Column(
            "meta",
            sa.JSON(),
            nullable=False,
            default=dict,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.CheckConstraint(
            "status IN ('uploaded', 'processing', 'processed', 'failed')",
            name="ck_uploaded_images_status",
        ),
    )

    op.drop_constraint("ck_ingestion_jobs_source_type", "ingestion_jobs", type_="check")
    op.create_check_constraint(
        "ck_ingestion_jobs_source_type",
        "ingestion_jobs",
        "source_type IN ('google_business', 'yelp', 'menu_url', 'website', 'social_links', "
        "'photo_vision', 'google_places')",
    )


def downgrade() -> None:
    op.drop_table("uploaded_images")

    op.drop_constraint("ck_ingestion_jobs_source_type", "ingestion_jobs", type_="check")
    op.create_check_constraint(
        "ck_ingestion_jobs_source_type",
        "ingestion_jobs",
        "source_type IN ('google_business', 'yelp', 'menu_url', 'website', 'social_links')",
    )
