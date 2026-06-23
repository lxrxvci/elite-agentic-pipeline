"""Aggregate CI/test/security signals into .pipeline/feedback.json.

This script is designed to run both locally (it executes tests/lint itself) and in
CI (it reads pre-computed result files written by the workflow jobs).

Usage:
    python scripts/ci_feedback.py --project-dir .

CI workflows should write the following JSON files before invoking this script:
- src/backend/.ci-feedback.json
- src/frontend/.ci-feedback.json
- .security-feedback.json

If those files are absent, the script falls back to running the checks directly.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def run_cmd(cmd: list[str], cwd: Path | None = None, timeout: int = 120) -> dict[str, Any]:
    """Run a command and return structured result metadata."""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
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


def collect_backend_feedback(project_dir: Path) -> dict[str, Any]:
    backend_dir = project_dir / "src" / "backend"
    ci_file = backend_dir / ".ci-feedback.json"

    if ci_file.exists():
        return json.loads(ci_file.read_text())

    if not backend_dir.exists():
        return {"status": "missing", "checks": {}}

    python = _find_backend_python(backend_dir)
    tests = run_cmd(
        [python, "-m", "pytest", "--ignore=tests/contracts", "-q", "--cov=src", "--cov-report=term-missing"],
        cwd=backend_dir,
        timeout=300,
    )
    lint = run_cmd([python, "-m", "ruff", "check", "src", "tests"], cwd=backend_dir)
    types = run_cmd([python, "-m", "mypy", "src"], cwd=backend_dir)
    bandit = run_cmd([python, "-m", "bandit", "-r", "src", "-ll", "-ii"], cwd=backend_dir)

    return {
        "status": "collected",
        "coverage_percent": parse_coverage(tests["stdout"]),
        "checks": {
            "tests": tests,
            "lint": lint,
            "typecheck": types,
            "bandit": bandit,
        },
    }


def collect_frontend_feedback(project_dir: Path) -> dict[str, Any]:
    frontend_dir = project_dir / "src" / "frontend"
    ci_file = frontend_dir / ".ci-feedback.json"

    if ci_file.exists():
        return json.loads(ci_file.read_text())

    if not frontend_dir.exists():
        return {"status": "missing", "checks": {}}

    tests = run_cmd(["npm", "run", "test:ci"], cwd=frontend_dir, timeout=300)
    lint = run_cmd(["npm", "run", "lint"], cwd=frontend_dir)
    types = run_cmd(["npm", "run", "typecheck"], cwd=frontend_dir)

    return {
        "status": "collected",
        "checks": {
            "tests": tests,
            "lint": lint,
            "typecheck": types,
        },
    }


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
    args = parser.parse_args()

    project_dir = args.project_dir.resolve()

    dora_file = project_dir / "dora-metrics.prom"
    dora: dict[str, Any] = {"status": "not_collected"}
    if dora_file.exists():
        dora = {"status": "collected", "metrics": dora_file.read_text().splitlines()}

    feedback = {
        "project": str(project_dir),
        "collected_at": datetime.now(timezone.utc).isoformat(),
        "backend": collect_backend_feedback(project_dir),
        "frontend": collect_frontend_feedback(project_dir),
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
