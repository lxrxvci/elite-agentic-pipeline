"""Aggregate CI/test/security signals into per-stack and project feedback files.

This script is designed to run both locally (it executes tests/lint itself) and in
CI (it reads pre-computed result files written by the workflow jobs).

Usage:
    python scripts/ci_feedback.py --project-dir .

When running locally, it writes:
- src/backend/.ci-feedback.json
- src/frontend/.ci-feedback.json
- .pipeline/feedback.json

CI workflows can choose to write the per-stack JSON files themselves and then
invoke this script for aggregation; if the files are absent, the script falls
back to running the checks directly.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def run_cmd(
    cmd: list[str],
    cwd: Path | None = None,
    timeout: int = 120,
    env: dict[str, str] | None = None,
) -> dict[str, Any]:
    """Run a command and return structured result metadata."""
    run_env = os.environ.copy()
    if env:
        run_env.update(env)
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=run_env,
        )
        return {
            "passed": result.returncode == 0,
            "returncode": result.returncode,
            "stdout": result.stdout.strip()[-500:] if result.stdout else "",
            "stderr": result.stderr.strip()[-500:] if result.stderr else "",
        }
    except Exception as exc:  # noqa: BLE001
        return {
            "passed": False,
            "returncode": -1,
            "stdout": "",
            "stderr": f"exception: {exc}",
        }


def parse_coverage(stdout: str) -> float:
    """Extract total coverage percentage from pytest-cov terminal output."""
    for line in reversed(stdout.splitlines()):
        if "Total" in line and "%" in line:
            try:
                return float(line.split()[-1].rstrip("%"))
            except (ValueError, IndexError):
                return 0.0
    return 0.0


def _find_backend_python(backend_dir: Path) -> str:
    """Return the Python executable to use for backend checks."""
    venv_python = backend_dir / ".venv" / "bin" / "python"
    if venv_python.exists():
        return str(venv_python)
    venv_python_windows = backend_dir / ".venv" / "Scripts" / "python.exe"
    if venv_python_windows.exists():
        return str(venv_python_windows)
    return sys.executable


def collect_backend_feedback(project_dir: Path, force: bool = False) -> dict[str, Any]:
    backend_dir = project_dir / "src" / "backend"
    ci_file = backend_dir / ".ci-feedback.json"

    if ci_file.exists() and not force:
        return json.loads(ci_file.read_text())

    if not backend_dir.exists():
        return {"status": "missing", "checks": {}}

    python = _find_backend_python(backend_dir)

    # Use a fresh SQLite database file so stale local test.db state cannot break coverage runs.
    test_db_fd, test_db_path = tempfile.mkstemp(suffix=".db", prefix="elite_test_")
    os.close(test_db_fd)
    test_db_url = f"sqlite:///{test_db_path}"

    try:
        tests = run_cmd(
            [
                python,
                "-m",
                "pytest",
                "--ignore=tests/contracts",
                "-q",
                "--cov=src",
                "--cov-report=term-missing",
            ],
            cwd=backend_dir,
            timeout=300,
            env={"TEST_DATABASE_URL": test_db_url},
        )
    finally:
        Path(test_db_path).unlink(missing_ok=True)

    lint = run_cmd([python, "-m", "ruff", "check", "src", "tests"], cwd=backend_dir)
    types = run_cmd([python, "-m", "mypy", "src"], cwd=backend_dir)
    bandit = run_cmd([python, "-m", "bandit", "-r", "src", "-ll", "-ii"], cwd=backend_dir)

    feedback = {
        "status": "collected",
        "coverage_percent": parse_coverage(tests["stdout"]),
        "checks": {
            "tests": tests,
            "lint": lint,
            "typecheck": types,
            "bandit": bandit,
        },
    }
    ci_file.write_text(json.dumps(feedback, indent=2))
    return feedback


def collect_frontend_feedback(project_dir: Path, force: bool = False) -> dict[str, Any]:
    frontend_dir = project_dir / "src" / "frontend"
    ci_file = frontend_dir / ".ci-feedback.json"

    if ci_file.exists() and not force:
        return json.loads(ci_file.read_text())

    if not frontend_dir.exists():
        return {"status": "missing", "checks": {}}

    tests = run_cmd(["npm", "run", "test:ci"], cwd=frontend_dir, timeout=300)
    lint = run_cmd(["npm", "run", "lint"], cwd=frontend_dir)
    types = run_cmd(["npm", "run", "typecheck"], cwd=frontend_dir)

    feedback = {
        "status": "collected",
        "checks": {
            "tests": tests,
            "lint": lint,
            "typecheck": types,
        },
    }
    ci_file.write_text(json.dumps(feedback, indent=2))
    return feedback


def collect_security_feedback(project_dir: Path) -> dict[str, Any]:
    ci_file = project_dir / ".security-feedback.json"

    if ci_file.exists():
        return json.loads(ci_file.read_text())

    return {"status": "not_collected_in_ci", "checks": {}}


def evaluate_stage_gates(feedback: dict[str, Any]) -> dict[str, Any]:
    """Evaluate which SDLC stage gates are currently satisfied."""
    backend = feedback.get("backend", {})
    frontend = feedback.get("frontend", {})
    security = feedback.get("security", {})

    backend_checks = backend.get("checks", {})
    frontend_checks = frontend.get("checks", {})
    security_checks = security.get("checks", {})

    def check_ok(category: dict[str, Any], name: str) -> bool:
        return category.get(name, {}).get("passed", False)

    gates = {
        "discovery": True,
        "shaping": True,
        "rfc_adr": True,
        "design_build": (
            check_ok(backend_checks, "tests")
            and check_ok(frontend_checks, "tests")
            and backend.get("coverage_percent", 0) >= 80
        ),
        "ci_cd": (
            check_ok(backend_checks, "lint")
            and check_ok(backend_checks, "typecheck")
            and check_ok(frontend_checks, "lint")
            and check_ok(frontend_checks, "typecheck")
            and check_ok(backend_checks, "bandit")
        ),
        "deploy_release": (
            check_ok(security_checks, "bandit")
            and check_ok(security_checks, "semgrep")
            and check_ok(security_checks, "trivy")
            and check_ok(security_checks, "trufflehog")
            and check_ok(security_checks, "codeql")
        ),
        "observe_improve": feedback.get("dora", {}).get("status") == "collected",
    }

    return gates


def main() -> None:
    parser = argparse.ArgumentParser(description="Aggregate CI feedback for agents")
    parser.add_argument("--project-dir", type=Path, default=Path("."))
    parser.add_argument(
        "--write-gates",
        action="store_true",
        help="Also write .pipeline/gates.json with per-stage gate status",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-run checks even if per-stack .ci-feedback.json files already exist",
    )
    parser.add_argument(
        "--backend-only",
        action="store_true",
        help="Collect and write only the backend feedback file",
    )
    parser.add_argument(
        "--frontend-only",
        action="store_true",
        help="Collect and write only the frontend feedback file",
    )
    args = parser.parse_args()

    project_dir = args.project_dir.resolve()

    if args.force:
        (project_dir / "src" / "backend" / ".ci-feedback.json").unlink(missing_ok=True)
        (project_dir / "src" / "frontend" / ".ci-feedback.json").unlink(missing_ok=True)

    if args.backend_only:
        collect_backend_feedback(project_dir, force=args.force)
        print("Backend feedback written to src/backend/.ci-feedback.json")
        return

    if args.frontend_only:
        collect_frontend_feedback(project_dir, force=args.force)
        print("Frontend feedback written to src/frontend/.ci-feedback.json")
        return

    dora_file = project_dir / "dora-metrics.prom"
    dora: dict[str, Any] = {"status": "not_collected"}
    if dora_file.exists():
        dora = {"status": "collected", "metrics": dora_file.read_text().splitlines()}

    feedback = {
        "project": str(project_dir),
        "collected_at": datetime.now(UTC).isoformat(),
        "backend": collect_backend_feedback(project_dir, force=args.force),
        "frontend": collect_frontend_feedback(project_dir, force=args.force),
        "security": collect_security_feedback(project_dir),
        "dora": dora,
        "gates": {},
    }
    feedback["gates"] = evaluate_stage_gates(feedback)

    pipeline_dir = project_dir / ".pipeline"
    pipeline_dir.mkdir(parents=True, exist_ok=True)

    feedback_path = pipeline_dir / "feedback.json"
    feedback_path.write_text(json.dumps(feedback, indent=2))
    print(f"Feedback written to {feedback_path}")

    if args.write_gates:
        gates_path = pipeline_dir / "gates.json"
        gates_path.write_text(json.dumps(feedback["gates"], indent=2))
        print(f"Gates written to {gates_path}")


if __name__ == "__main__":
    main()
