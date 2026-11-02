"""Add proctor idempotency columns and unique indexes."""
from alembic import op
import sqlalchemy as sa

revision = "0001_proctor_idempotency"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table in ("proctorevent", "proctorsnapshot"):
        cols = {c["name"] for c in inspector.get_columns(table)}
        if "client_event_id" not in cols:
            op.add_column(table, sa.Column("client_event_id", sa.String(), nullable=True))
    op.create_index("uq_proctor_event_session_client", "proctorevent", ["session_id", "client_event_id"], unique=True)
    op.create_index("uq_proctor_snapshot_session_client", "proctorsnapshot", ["session_id", "client_event_id"], unique=True)

def downgrade():
    op.drop_index("uq_proctor_snapshot_session_client", table_name="proctorsnapshot")
    op.drop_index("uq_proctor_event_session_client", table_name="proctorevent")
