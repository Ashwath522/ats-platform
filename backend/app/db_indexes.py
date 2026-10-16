"""Idempotent secondary indexes (SQLite + Postgres), run once at startup.

``SQLModel.metadata.create_all`` only creates indexes together with a *new*
table, so databases created before a column got ``index=True`` (production
Supabase, the dev DB) are missing them. This module

1. re-declares every non-unique model index with ``CREATE INDEX IF NOT EXISTS``;
2. adds composite indexes for the hot query shapes (see ``EXTRA_INDEXES``).

Cost on a far-away database matters (each statement is a round trip), so the
existing index names are read in ONE query and only the missing statements
are sent - on Postgres batched into a single round trip. A normal restart
therefore costs one query.
"""
from __future__ import annotations

import logging
from typing import Iterable, List, Tuple

from sqlalchemy import text
from sqlmodel import SQLModel

logger = logging.getLogger("ats-platform")

# (index name, table, columns) - shaped after the WHERE / ORDER BY clauses of
# the hot endpoints (dashboard, opportunities, notifications, pipelines).
EXTRA_INDEXES: List[Tuple[str, str, Tuple[str, ...]]] = [
    ("ix_job_status_created", "job", ("status", "created_at")),
    ("ix_job_recruiter_status", "job", ("recruiter_id", "status")),
    ("ix_job_branch", "job", ("branch",)),
    ("ix_application_job_applied", "application", ("job_id", "applied_at")),
    ("ix_application_candidate_job", "application", ("candidate_id", "job_id")),
    ("ix_application_status", "application", ("status",)),
    ("ix_application_applied_at", "application", ("applied_at",)),
    ("ix_auditlog_candidate_created", "decisionauditlog", ("candidate_id", "created_at")),
    ("ix_auditlog_created", "decisionauditlog", ("created_at",)),
    ("ix_offer_candidate_status", "offer", ("candidate_id", "status")),
    ("ix_offer_recruiter_responded", "offer", ("recruiter_id", "responded_at")),
    ("ix_schedint_candidate_status_start", "scheduledinterview", ("candidate_id", "status", "starts_at")),
    ("ix_schedint_recruiter_start", "scheduledinterview", ("recruiter_id", "starts_at")),
    ("ix_savedjob_candidate_job", "savedjob", ("candidate_id", "job_id")),
    ("ix_user_created_at", "user", ("created_at",)),
    ("ix_candidateuser_created_at", "candidateuser", ("created_at",)),
    ("ix_interviewsession_cand_mode", "interviewsession", ("candidate_id", "mode", "started_at")),
    ("ix_externaljob_status_posted", "externaljob", ("status", "posted_at")),
    ("ix_liveresource_branch_status", "liveresource", ("branch", "status", "published_at")),
    ("ix_vectordoc_coll_doc", "vectordoc", ("collection", "doc_id")),
    ("ix_emailtoken_email_purpose", "emailtoken", ("email", "purpose")),
    ("ix_studentproject_cand_status", "studentproject", ("candidate_id", "status")),
    ("ix_recruiternote_rec_cand", "recruiternote", ("recruiter_id", "candidate_id")),
]


def _declared_indexes() -> Iterable[Tuple[str, str, Tuple[str, ...]]]:
    for table in SQLModel.metadata.sorted_tables:
        for idx in table.indexes:
            if idx.unique:
                continue  # never risk failing startup on existing duplicate rows
            cols = tuple(c.name for c in idx.columns)
            if idx.name and cols:
                yield idx.name, table.name, cols


def _existing(conn, dialect: str) -> set:
    if dialect == "postgresql":
        rows = conn.execute(text("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"))
    else:
        rows = conn.execute(text("SELECT name FROM sqlite_master WHERE type = 'index'"))
    return {r[0] for r in rows}


def wanted_indexes() -> List[Tuple[str, str, Tuple[str, ...]]]:
    seen, out = set(), []
    for name, table, cols in list(_declared_indexes()) + EXTRA_INDEXES:
        if name not in seen:
            seen.add(name)
            out.append((name, table, cols))
    return out


def ensure_indexes(engine) -> int:
    """Create missing indexes; returns how many were created. Never raises."""
    try:
        dialect = engine.dialect.name
        q = engine.dialect.identifier_preparer.quote
        known_tables = {t.name: {c.name for c in t.columns} for t in SQLModel.metadata.sorted_tables}
        with engine.connect() as conn:
            have = _existing(conn, dialect)
        stmts = []
        for name, table, cols in wanted_indexes():
            if name in have or table not in known_tables or not set(cols) <= known_tables[table]:
                continue
            stmts.append(f"CREATE INDEX IF NOT EXISTS {q(name)} ON {q(table)} ({', '.join(q(c) for c in cols)})")
        if not stmts:
            return 0
        if dialect == "postgresql":
            try:
                with engine.begin() as conn:
                    conn.exec_driver_sql(";\n".join(stmts))  # one round trip
                logger.info("[DB] created %d missing indexes", len(stmts))
                return len(stmts)
            except Exception as exc:  # fall back to one-by-one so one bad index can't block the rest
                logger.warning("[DB] batched index creation failed (%s); retrying individually", exc)
        created = 0
        for stmt in stmts:
            try:
                with engine.begin() as conn:
                    conn.exec_driver_sql(stmt)
                created += 1
            except Exception as exc:  # pragma: no cover - e.g. table missing on an old schema
                logger.warning("[DB] %s failed: %s", stmt, exc)
        logger.info("[DB] created %d missing indexes", created)
        return created
    except Exception:  # pragma: no cover - indexes are an optimisation, never block startup
        logger.exception("[DB] ensure_indexes failed")
        return 0
