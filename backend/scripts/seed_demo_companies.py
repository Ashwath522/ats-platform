"""Create / refresh (or remove) the 20 fictional DEMO companies for local dev.

    cd backend && python scripts/seed_demo_companies.py /path/outside/repo/demo_logins.csv
    python scripts/seed_demo_companies.py --remove

Same logic as POST / DELETE /api/admin/demo/companies. Passwords are generated
only for accounts created by this run and written ONLY to the CSV you pass
(it must be outside the repository). Existing accounts keep their password.
NEVER run against production unless you really want demo companies there.
"""
import argparse
import csv
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db import init_db  # noqa: E402
from app.services import demo_companies  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("csv_path", nargs="?", help="where to write the logins CSV (outside the repo)")
    ap.add_argument("--remove", action="store_true", help="delete all demo companies, recruiters, jobs and their applications")
    args = ap.parse_args()
    init_db()
    if args.remove:
        print(demo_companies.remove_all())
        return 0
    if not args.csv_path:
        ap.error("csv_path is required (unless --remove)")
    path = os.path.abspath(os.path.expanduser(args.csv_path))
    if path == ROOT or path.startswith(ROOT + os.sep):
        ap.error(f"refusing to write passwords inside the repository ({ROOT}); choose a path outside it")
    result = demo_companies.create_or_refresh()
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["company", "slug", "recruiter_email", "password", "jobs", "account"])
        for r in result["logins"]:
            w.writerow([r["company"], r["slug"], r["email"], r["password"] or "(unchanged - existing account)",
                        r["jobs"], "created" if r["created"] else "existing"])
    print(f"{result['companies']} demo companies ready, {result['accounts_created']} new recruiter account(s). Logins -> {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
