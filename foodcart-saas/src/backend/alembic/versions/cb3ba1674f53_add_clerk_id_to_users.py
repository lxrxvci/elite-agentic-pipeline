"""add clerk_id to users

Revision ID: cb3ba1674f53
Revises: 20250621_initial_freelancer
Create Date: 2026-06-22 21:51:36.942145

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "cb3ba1674f53"
down_revision: Union[str, None] = "20250621_initial_freelancer"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("clerk_id", sa.String(length=255), nullable=True),
    )
    op.create_index(op.f("ix_users_clerk_id"), "users", ["clerk_id"], unique=True)


def downgrade() -> None:
    op.drop_index(op.f("ix_users_clerk_id"), table_name="users")
    op.drop_column("users", "clerk_id")
