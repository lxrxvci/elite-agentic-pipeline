"""Copy validated example_project files back into the platform scaffold.

Mappings:
  example_project/scripts                 -> pipeline/platform/scaffold/scripts
  example_project/observability           -> pipeline/platform/scaffold/observability
  example_project/infra                   -> pipeline/platform/scaffold/infra
  example_project/.github/workflows       -> pipeline/platform/scaffold/.github/workflows
  example_project/src/backend             -> pipeline/platform/scaffold/backend
  example_project/src/frontend            -> pipeline/platform/scaffold/frontend
  example_project/tests/perf              -> pipeline/platform/scaffold/tests/perf
"""

from __future__ import annotations

import argparse
import shutil
from pathlib import Path

MAPPINGS: list[tuple[str, str]] = [
    ("example_project/scripts", "pipeline/platform/scaffold/scripts"),
    ("example_project/observability", "pipeline/platform/scaffold/observability"),
    ("example_project/infra", "pipeline/platform/scaffold/infra"),
    ("example_project/.github/workflows", "pipeline/platform/scaffold/.github/workflows"),
    ("example_project/src/backend", "pipeline/platform/scaffold/backend"),
    ("example_project/src/frontend", "pipeline/platform/scaffold/frontend"),
    ("example_project/tests/perf", "pipeline/platform/scaffold/tests/perf"),
]

IGNORE_PATTERNS = shutil.ignore_patterns(
    "__pycache__",
    "*.pyc",
    ".venv",
    "node_modules",
    ".next",
    "coverage",
    "test-results",
    ".pytest_cache",
    ".ruff_cache",
    ".vercel",
    "test.db",
    ".env",
)


def sync_scaffold(project_dir: Path, scaffold_dir: Path) -> None:
    for src_rel, dst_rel in MAPPINGS:
        src = project_dir.parent / src_rel
        dst = project_dir.parent / dst_rel
        if not src.exists():
            print(f"SKIP: source does not exist: {src}")
            continue
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=IGNORE_PATTERNS)
        print(f"SYNC: {src} -> {dst}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync example project into platform scaffold")
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=Path("example_project"),
        help="Path to the validated example project",
    )
    args = parser.parse_args()
    sync_scaffold(args.project_dir.resolve(), Path("pipeline/platform/scaffold"))


if __name__ == "__main__":
    main()
