"""add created_by to clients, projects, time_entries, invoices

Revision ID: 20250623_add_created_by_to_resources
Revises: 5e8d3c9b1a42
Create Date: 2026-06-23 13:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "20250623_add_created_by_to_resources"
down_revision: Union[str, None] = "5e8d3c9b1a42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("clients", "projects", "time_entries", "invoices"):
        op.add_column(
            table,
            sa.Column("created_by", sa.UUID(), nullable=True),
        )
        op.create_index(f"ix_{table}_created_by", table, ["created_by"], unique=False)
        op.create_foreign_key(
            f"fk_{table}_created_by_users",
            table,
            "users",
            ["created_by"],
            ["id"],
        )


def downgrade() -> None:
    for table in ("clients", "projects", "time_entries", "invoices"):
        op.drop_constraint(f"fk_{table}_created_by_users", table, type_="foreignkey")
        op.drop_index(f"ix_{table}_created_by", table_name=table)
        op.drop_column(table, "created_by")
