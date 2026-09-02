import datetime
from typing import Optional, Dict, Any
from sqlmodel import Session, select

from ..db import Application, utc_now
from .audit import record_audit_event


def purge_expired_proctoring_data(session: Session, retention_days: int = 30) -> Dict[str, Any]:
    """
    Data retention governance:
    Purges raw proctoring media and transcript signals older than the retention window (e.g. 30 days)
    while strictly preserving high-level aggregated risk scores, evaluation scores, and audit log history.
    """
    cutoff_date = utc_now() - datetime.timedelta(days=retention_days)
    
    # Query completed applications older than cutoff date that still have raw evidence
    apps = session.exec(
        select(Application).where(
            Application.interview_status == "completed",
            Application.applied_at <= cutoff_date
        )
    ).all()

    purged_count = 0
    for app in apps:
        needs_purge = (
            (app.interview_evidence_url and not app.interview_evidence_url.startswith("[")) or
            (app.interview_transcript_json and app.interview_transcript_json not in ("[]", "{}"))
        )
        if needs_purge:
            app.interview_evidence_url = f"[Purged per {retention_days}-day data retention policy]"
            app.interview_transcript_json = "[]"
            session.add(app)

            record_audit_event(
                session=session,
                event_type="data_retention_purge",
                application_id=app.id,
                candidate_id=app.candidate_id,
                job_id=app.job_id,
                human_action="retention_window_cleanup",
                final_recommendation=f"Raw proctoring video and transcript purged after {retention_days} days retention.",
            )
            purged_count += 1

    session.commit()
    return {
        "purged_count": purged_count,
        "retention_days": retention_days,
        "cutoff_date": cutoff_date.isoformat(),
    }
