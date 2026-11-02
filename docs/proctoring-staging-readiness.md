# Proctoring — staging readiness (2026-11-02)

Base: `c076db4` (+ project-analysis merge `0fdf9e0` and fix `0b37a17`). All results below were produced in this session.

## Verdict

**Ready for staging.** Every item in the definition of done has code and passing tests; the Docker fail-closed start was also confirmed on a real image. Remaining items under *Not verified here* are staging checks (pooler mode, real-browser run, load), not known defects.

## Defects found and fixed

| # | Defect | Impact | Fix | Proof |
|---|---|---|---|---|
| 1 | `db_pool.py` ran any `SELECT` in autocommit, including `SELECT pg_advisory_xact_lock(...)` | The per-session lock was released immediately, so **quotas did not hold under concurrency** (40 events stored against a quota of 30, measured) | Statements calling transaction-scoped functions now always open a transaction | `test_concurrent_event_batches_respect_quota_and_report_exactly`, `test_app_engine_holds_the_lock_until_commit`, `test_db_pool_never_runs_transaction_scoped_selects_in_autocommit` |
| 2 | `text` not imported in `proctoring.py` | Every PostgreSQL upload would have raised `NameError` → 500 | Import + two-key lock `pg_advisory_xact_lock('PRCT', session_id)` | all PostgreSQL concurrency tests |
| 3 | One `IntegrityError` rolled back the whole event batch, but the response still listed those events as stored | **Browser deleted events that were never saved** | Per-row savepoints; explicit per-record status `persisted / duplicate / invalid / failed`; a failed commit turns every row into `failed` | `test_mixed_batch_returns_accurate_per_record_outcomes`, `test_storage_error_is_failed_not_acknowledged`, `test_failed_commit_reports_every_record_failed` |
| 4 | Any re-used `client_event_id` was treated as a duplicate | A different event or image could be silently acknowledged | Duplicate only when content matches; otherwise `invalid` (events) / 409 (snapshots) | `test_snapshot_exact_duplicate_vs_conflict_and_linkage` |
| 5 | Lock taken after the duplicate check | Concurrent identical uploads could race | Lock first, then duplicate check and quota | `test_concurrent_identical_snapshot_is_stored_once` |
| 6 | Authorization trusted `interview_session.job_id` | A forged or stale session row could point a session at another recruiter's job | Chain check: recruiter → owned job → application → session → snapshot; every denormalized id must match, else 404 for everyone except admins | `test_forged_session_job_id_cannot_grant_access`, `test_snapshot_with_mismatched_denormalized_ids_is_refused`, `test_application_belonging_to_another_candidate_is_refused` |
| 7 | Migration `0001` read tables that don't exist on a fresh database | **The API could never start on a new database** | `0000_baseline` (create missing tables) + idempotent `0001` | `test_fresh_database_migrates_and_rerun_is_idempotent` |
| 8 | Legacy duplicates would make `0001` fail with a raw index error | Unclear for operators | `0001` stops before changing anything and explains the reconciliation | `test_legacy_duplicates_fail_closed_without_deleting_evidence` |
| 9 | Events waiting for a snapshot were persisted with `waiting:true` | After a refresh they were **never sent** | Flags reset on load; server links snapshot↔event by `client_event_id` in both orders | `a page refresh resumes the stored queue`, linkage test |
| 10 | Corrupted IndexedDB records were sent forever; storage failures were silent | Stuck queues, invisible loss risk | Records validated on load (dropped and counted); memory fallback reported via `queueHealth()` and sent with `/finish` | `proctor-queue.test.js` |
| 11 | After `/finish` the session closed, so queued evidence was rejected | Evidence from a reconnecting browser was lost | `finalize()` retries up to 12 s; the server accepts uploads for `PROCTOR_LATE_SYNC_MINUTES` (30) after finish, marks them `late_sync` and recomputes the server risk | `test_late_evidence_accepted_in_grace_window_and_updates_server_risk`, e2e test |
| 12 | Risk formula duplicated in two files | Could drift | One `server_risk()` used by `/finish`, reports and late sync | e2e test |
| 13 | `requirements.txt` pinned a GitHub download (`en_core_web_sm`) | `pip install` failed without GitHub access | Moved to `requirements-nlp.txt`; Docker still installs it; the code already falls back to `spacy.blank("en")` | install works without GitHub |

## Test results (this session)

| Suite | Database | Result |
|---|---|---|
| Full backend suite | SQLite | **493 passed**, 9 skipped (PostgreSQL-only tests) |
| `test_postgres_proctoring.py`: migrations, fail-closed start with real Alembic, quotas and idempotency against a 2-worker uvicorn server | PostgreSQL 16 | **9 passed**; concurrency subset re-run 3× → 4/4 each time |
| Proctoring integrity + e2e + portal + interview API | PostgreSQL 16 (`ATS_TEST_DATABASE_URL`) | **25 passed**, 1 skipped (SQLite-trigger test) |
| `test_startup_migrations.py` (start.sh with failing/succeeding Alembic) | — | 5 passed |
| Frontend (vitest) | — | **119 passed** (incl. 9 new queue/recovery tests) |
| Frontend production build | — | passed |
| `git diff --check` | — | clean |

## Trust boundaries (as implemented)

- **Server-verified:** receipt time, stored row id, persistence outcome, late-sync flag, authorization chain, and the risk score computed from stored rows (`server_risk`).
- **Client-reported:** event type, severity and time chosen by the browser detectors, detector status/health, device tier, the browser's own risk estimate, and sync/storage health.
- The browser's risk value is stored and shown labelled "not used"; it is never an input to `interview_risk_score`. Note that severities are still classified by the browser. The server validates them against an allow-list, but cannot independently confirm what the camera saw.

## Not verified here (do before or on staging)

1. ~~Docker image build and container start~~ — **verified on the developer Mac (Docker Desktop, 2026-11-02):** image built in 634 s (incl. `requirements-nlp.txt`); `docker run` with an unreachable `DATABASE_URL` printed `[start] applying database migrations`, Alembic failed with `OperationalError`, container exited with code 1 and uvicorn never started.
2. **Supabase pooler behaviour.** The advisory lock was verified on a direct PostgreSQL connection. Render uses Supabase's *session* pooler, which keeps one server connection per client session, so transaction-scoped locks work. A *transaction* pooler (port 6543) would also work for `xact` locks but is untested.
3. **Real browsers.** IndexedDB, quota and offline behaviour were tested with a simulated store and network (vitest, Node). Manual check: start an interview, turn the network off for 1 minute, refresh, reconnect, finish. The recruiter timeline must show every event, with "synced after finish" where it applies.
4. **Load beyond 2 workers / 12 parallel requests** was not measured.

## Known limitations (by design)

- Evidence still queued after the 30-minute grace window is only uploaded if the candidate reopens the interview page. The recruiter sees the outstanding count from the `/finish` sync summary.
- A recruiter sees evidence only for jobs they own. Team-member sharing is not part of the current permission model.
- Snapshot cap 32 per session (`PROCTOR_MAX_SNAPSHOTS`), event cap 600 (`PROCTOR_MAX_EVENTS`); excess items are reported as `invalid` (`session_event_limit`) and kept on the device, not silently dropped.
