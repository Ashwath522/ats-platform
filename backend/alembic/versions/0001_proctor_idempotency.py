"""Proctor idempotency: client_event_id columns + unique (session_id, client_event_id).

Idempotent (safe on fresh databases where the baseline already created the
constraint, and on re-runs). Refuses to continue — without deleting anything —
when historical duplicate rows exist; see MIGRATIONS.md for the operator-approved
reconciliation procedure.
"""
from alembic import op
import sqlalchemy as sa

revision = "0001_proctor_idempotency"
down_revision = "0000_baseline"
branch_labels = None
depends_on = None

TARGETS = (("proctorevent", "uq_proctor_event_session_client"), ("proctorsnapshot", "uq_proctor_snapshot_session_client"))


class LegacyDuplicateEvidence(RuntimeError):
    pass


def _names(insp, table):
    names = {i["name"] for i in insp.get_indexes(table)}
    try:
        names |= {u["name"] for u in insp.get_unique_constraints(table)}
    except NotImplementedError:
        pass
    return names


def upgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table, index in TARGETS:
        if "client_event_id" not in {c["name"] for c in insp.get_columns(table)}:
            op.add_column(table, sa.Column("client_event_id", sa.String(), nullable=True))
    insp = sa.inspect(bind)
    dupes = {}
    for table, _ in TARGETS:
        n = bind.execute(sa.text(
            f"SELECT COUNT(*) FROM (SELECT session_id, client_event_id FROM {table} "
            f"WHERE client_event_id IS NOT NULL GROUP BY session_id, client_event_id HAVING COUNT(*) > 1) d")).scalar()
        if n:
            dupes[table] = n
    if dupes:
        raise LegacyDuplicateEvidence(
            "Duplicate (session_id, client_event_id) rows exist: " + ", ".join(f"{t}: {n} group(s)" for t, n in dupes.items())
            + ". No data was changed. Reconcile them as described in backend/MIGRATIONS.md, then re-run `alembic upgrade head`.")
    for table, index in TARGETS:
        if index not in _names(insp, table):
            op.create_index(index, table, ["session_id", "client_event_id"], unique=True)


def downgrade():
    bind = op.get_bind()
    insp = sa.inspect(bind)
    for table, index in TARGETS:
        if index in {i["name"] for i in insp.get_indexes(table)}:
            op.drop_index(index, table_name=table)
