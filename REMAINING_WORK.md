# ATS Platform — Remaining Work

Repo: https://github.com/Ashwath522/ats-platform

This doc has gone stale multiple times during development (describing an
earlier pre-portal state after the portal was already built). See
`README.md`'s "Verified current state" section for what the app actually
does right now — this doc is specifically about what's genuinely left,
not a running history.

## Genuinely remaining, in rough priority order

1. **No CI actually running.** `.github/workflows/ci.yml` exists in the
   repo's working tree but has repeatedly failed to push to GitHub — the
   token used across this project's development sessions lacks the
   `workflow` scope required for changes under `.github/workflows/`. The
   file itself is correct (runs `pytest` + frontend build on push/PR).
   Needs either a token with `workflow` scope, or manually adding the
   file via the GitHub web UI.

2. **Auth is intentionally minimal.** No email verification, no password
   reset flow, no refresh tokens (both candidate and recruiter auth).
   Documented directly in `backend/app/auth.py`. Add before any real
   multi-tenant deployment — fine for a project/demo as-is.

3. **SQLite + ad-hoc migrations.** Schema changes are raw `ALTER TABLE`
   statements run at startup in `db.py` (e.g. adding `owner_username`,
   `apply_url` columns to existing tables), not a real migration tool.
   Works for a single demo DB file; would need Alembic or equivalent
   before running against a shared production database.

4. **Frontend has no component library or state management library.**
   Plain `useState`/`useEffect` throughout, custom CSS, no design system.
   Functional and reasonably styled, not polished to a product-launch
   bar. No frontend component tests exist at all.

5. **JD history isn't tracked in the UI.** Only the latest job
   description per company/job is used or shown — older ones become
   orphaned rows with no way to browse them.

6. **PDF extraction hasn't been stress-tested broadly.** Known fixes
   exist for multi-column templates (word-spacing bug) and
   corrupted/password-protected files (specific error messages), but
   this hasn't been run against a wide variety of real-world resume
   templates and layouts beyond what's been manually tested so far.

7. **Backend integration tests exist but aren't exhaustive.** 44 tests
   across 9 files cover scoring, auth, ownership, MIME validation,
   portal basics (haversine, token roles, admin flow), deep analysis,
   and vocab learning — but there's no comprehensive end-to-end test of
   the full candidate journey (register → profile → apply → recruiter
   sees ranked applicant) as a single automated test.

8. **Real embedding model + real LLM calls need periodic re-verification
   on a machine with real internet access.** This project has been
   developed largely in network-restricted sandboxes that can't reach
   `huggingface.co`, `generativelanguage.googleapis.com`, or
   `api.anthropic.com` — an offline TF-IDF stub stands in for embeddings
   during sandbox testing, and LLM features are tested with mocked
   clients. Both have been confirmed working for real on the project
   owner's own machine at various points, but any given commit's exact
   behavior with the real model/API hasn't necessarily been re-verified
   since. If something scoring- or LLM-related seems off, check whether
   it was actually re-tested with real dependencies before assuming the
   logic is wrong.

## A pattern worth knowing about this repo

Several bugs have been found, fixed, and then **regressed** later in this
project's history — the exact same `keyword_coverage` honesty bug and a
missing-import crash on the candidate feed were each fixed twice. This
happened because: (a) work was sometimes left uncommitted when a session
ended, and got lost to a later `git reset --hard` or force-push, and
(b) at least once, a regression test was itself reverted to assert the
*buggy* behavior, so `pytest` kept passing even though the bug was back.

If you're picking up work here: **run the full test suite together, not
file-by-file** (isolated runs have masked cross-file issues before, like
rate-limiter state bleeding between test files), **commit and push
immediately after every verified fix** rather than batching multiple
fixes into one uncommitted working session, and if you're re-fixing
something that sounds like it should already be fixed, check `git log`
and actually re-run the specific scenario before assuming the report
describing it is wrong — it's happened more than once that a "fix" had
quietly regressed.
