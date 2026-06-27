"""publish_existing_sites

Revision ID: 60f1b16b2c74
Revises: 20250625_add_site_brand_colors
Create Date: 2026-06-26 00:06:06.104514

"""
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '60f1b16b2c74'
down_revision: str | None = '20250625_add_site_brand_colors'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_BACKUP_TABLE = '_sites_publish_state_backup'


def upgrade() -> None:
    # Onboarding now publishes sites by default. Backfill any existing
    # draft sites created before that change so they remain visible.
    # We keep a backup of the original publish_state so downgrade can
    # restore it precisely instead of blanket-reverting every published site.
    op.create_table(
        _BACKUP_TABLE,
        sa.Column('site_id', sa.String(length=36), nullable=False, primary_key=True),
        sa.Column('original_publish_state', sa.String(length=20), nullable=False),
    )

    sites = sa.table('sites', sa.column('id', sa.String), sa.column('publish_state', sa.String))
    backup = sa.table(
        _BACKUP_TABLE,
        sa.column('site_id', sa.String),
        sa.column('original_publish_state', sa.String),
    )

    op.execute(
        backup.insert().from_select(
            ['site_id', 'original_publish_state'],
            sites.select().where(sites.c.publish_state == 'draft').with_only_columns(
                sites.c.id, sites.c.publish_state
            ),
        )
    )

    op.execute(
        sites.update()
        .where(sites.c.publish_state == 'draft')
        .values({'publish_state': 'published'})
    )


def downgrade() -> None:
    # Restore the original publish_state for sites we backfilled. Sites that
    # were created after this migration are left untouched.
    sites = sa.table('sites', sa.column('id', sa.String), sa.column('publish_state', sa.String))
    backup = sa.table(
        _BACKUP_TABLE,
        sa.column('site_id', sa.String),
        sa.column('original_publish_state', sa.String),
    )

    op.execute(
        sites.update()
        .where(sites.c.id == backup.c.site_id)
        .values({'publish_state': backup.c.original_publish_state})
    )

    op.drop_table(_BACKUP_TABLE)
