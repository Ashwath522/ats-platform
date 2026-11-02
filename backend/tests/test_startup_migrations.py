"""Container entrypoint (start.sh, used by the Dockerfile CMD) is fail-closed.
The real-Alembic + PostgreSQL version of this check is in test_postgres_proctoring.py."""
import os
import subprocess
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[1]


def _run(tmp_path, alembic_exit):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    marker = tmp_path / "uvicorn-started"
    (bin_dir / "alembic").write_text(f"#!/bin/sh\necho alembic \"$@\" >> {tmp_path}/calls\nexit {alembic_exit}\n")
    (bin_dir / "uvicorn").write_text(f"#!/bin/sh\necho \"$@\" > {marker}\n")
    for f in bin_dir.iterdir():
        f.chmod(0o755)
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "PORT": "9123"}
    r = subprocess.run(["sh", str(BACKEND / "start.sh")], env=env, capture_output=True, text=True, timeout=30)
    return r, marker


@pytest.mark.parametrize("code", [1, 2, 255])
def test_failed_migration_stops_startup(tmp_path, code):
    r, marker = _run(tmp_path, code)
    assert r.returncode == code and not marker.exists()
    assert (tmp_path / "calls").read_text().strip() == "alembic upgrade head"


def test_successful_migration_then_execs_uvicorn(tmp_path):
    r, marker = _run(tmp_path, 0)
    assert r.returncode == 0 and marker.exists()
    assert "--port 9123" in marker.read_text() and "app.main:app" in marker.read_text()


def test_dockerfile_uses_the_fail_closed_entrypoint():
    text = (BACKEND / "Dockerfile").read_text()
    cmd = [l for l in text.splitlines() if l.startswith("CMD")]
    assert cmd == ['CMD ["sh", "/app/start.sh"]']
    script = (BACKEND / "start.sh").read_text()
    assert "set -eu" in script and "|| true" not in script and "&" not in script.replace("&&", "")
