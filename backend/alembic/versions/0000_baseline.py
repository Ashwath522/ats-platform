"""Baseline: create any missing tables from the current models.

Production databases created before Alembic were built by ``init_db()``; a fresh
database has no tables at all. ``create_all(checkfirst=True)`` only creates
tables that do not exist, never alters or drops anything, so it is safe for
both. Because the baseline reflects the current models, every later revision
must be idempotent (check before adding a column/index).
"""
from alembic import op
from sqlmodel import SQLModel

import app.db  # noqa: F401  (registers every table on SQLModel.metadata)

revision = "0000_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    SQLModel.metadata.create_all(bind=op.get_bind(), checkfirst=True)


def downgrade():
    # Never drop evidence or business data automatically.
    pass
