"""Aggregate CI/test/metric signals into a feedback file for agent context.

Usage:
    python scripts/feedback_aggregator.py --project-dir .
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path


def run_cmd(cmd: list[str], cwd: Path | None = None) -> str:
    try:
        result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=60)
        return result.stdout.strip()
    except Exception as exc:
        return f"error: {exc}"


def collect_backend_feedback(project_dir: Path) -> dict:
    backend_dir = project_dir / "src" / "backend"
    if not backend_dir.exists():
        return {}

    coverage = run_cmd(
        ["python", "-m", "pytest", "-q", "--cov=src", "--cov-report=term-missing"],
        cwd=backend_dir,
    )
    lint = run_cmd(["python", "-m", "ruff", "check", "src", "tests"], cwd=backend_dir)
    types = run_cmd(["python", "-m", "mypy", "src"], cwd=backend_dir)

    return {
        "coverage": coverage.splitlines()[-10:] if coverage else [],
        "lint": "passed" if "All checks passed" in lint else lint,
        "typecheck": "passed" if "Success" in types else types,
    }


def collect_frontend_feedback(project_dir: Path) -> dict:
    frontend_dir = project_dir / "src" / "frontend"
    if not frontend_dir.exists():
        return {}

    tests = run_cmd(["npm", "run", "test:ci"], cwd=frontend_dir)
    lint = run_cmd(["npm", "run", "lint"], cwd=frontend_dir)
    types = run_cmd(["npm", "run", "typecheck"], cwd=frontend_dir)

    return {
        "tests": "passed" if "Test Files" in tests and "failed" not in tests else tests,
        "lint": "passed" if "No ESLint" in lint or "error" not in lint.lower() else lint,
        "typecheck": "passed" if "error TS" not in types else types,
    }


def collect_dora_feedback(project_dir: Path) -> dict:
    dora_file = project_dir / "dora-metrics.prom"
    if not dora_file.exists():
        return {"status": "not collected"}
    return {"metrics": dora_file.read_text().splitlines()}


def main() -> None:
    parser = argparse.ArgumentParser(description="Aggregate feedback for agents")
    parser.add_argument("--project-dir", type=Path, default=Path("."))
    args = parser.parse_args()

    project_dir = args.project_dir.resolve()
    feedback = {
        "project": str(project_dir),
        "backend": collect_backend_feedback(project_dir),
        "frontend": collect_frontend_feedback(project_dir),
        "dora": collect_dora_feedback(project_dir),
    }

    feedback_path = project_dir / ".pipeline" / "feedback.json"
    feedback_path.parent.mkdir(parents=True, exist_ok=True)
    feedback_path.write_text(json.dumps(feedback, indent=2))
    print(f"Feedback written to {feedback_path}")


if __name__ == "__main__":
    main()
