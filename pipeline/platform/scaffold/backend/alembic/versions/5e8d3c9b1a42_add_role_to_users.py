"""add role to users

Revision ID: 5e8d3c9b1a42
Revises: cb3ba1674f53
Create Date: 2026-06-23 03:15:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "5e8d3c9b1a42"
down_revision: Union[str, None] = "cb3ba1674f53"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("role", sa.String(length=50), nullable=False, server_default="member"),
    )


def downgrade() -> None:
    op.drop_column("users", "role")
