"""publish_existing_sites

Revision ID: 60f1b16b2c74
Revises: 20250625_add_site_brand_colors
Create Date: 2026-06-26 00:06:06.104514

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '60f1b16b2c74'
down_revision: Union[str, None] = '20250625_add_site_brand_colors'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Onboarding now publishes sites by default. Backfill any existing
    # draft sites created before that change so they remain visible.
    sites = sa.table('sites', sa.column('publish_state', sa.String))
    op.execute(
        sites.update()
        .where(sites.c.publish_state == 'draft')
        .values({'publish_state': 'published'})
    )


def downgrade() -> None:
    pass
