"""Add brand_colors to sites.

Revision ID: 20250625_add_site_brand_colors
Revises: 20250624_foodcart_cycle1
Create Date: 2026-06-25 00:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "20250625_add_site_brand_colors"
down_revision: Union[str, None] = "20250624_foodcart_cycle1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "sites",
        sa.Column("brand_colors", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("sites", "brand_colors")
