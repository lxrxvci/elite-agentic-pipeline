#!/usr/bin/env python3
"""
Sample parent-agent runner for the Elite Agentic SDLC Pipeline.

This script demonstrates the contract between the orchestrator and a parent AI
that dispatches subagents. It runs the full cycle:

    loop --prepare [--dispatch] -> print tool_calls -> loop --complete

In a Kimi Code CLI context, the parent should read the printed ``tool_calls``
array and invoke the ``Agent`` tool for each entry, then write the result files
expected by the orchestrator.

Usage:
    python pipeline/run_parent_agent.py --project-dir example_project

Environment:
    ELITE_AGENT_RUNNER  Optional shell command that accepts a manifest path.
                        If unset, the script prints the tool_calls array and
                        stops after the prepare step.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent
ORCHESTRATOR = PIPELINE_DIR / "orchestrator.py"


def run_orchestrator(
    project_dir: Path, *args: str
) -> subprocess.CompletedProcess[str]:
    """Run the orchestrator CLI and return the completed process."""
    cmd = [
        sys.executable,
        str(ORCHESTRATOR),
        "--project-dir",
        str(project_dir),
        *args,
    ]
    return subprocess.run(cmd, capture_output=True, text=True, check=False)


def parse_prepare_report(stdout: str) -> dict[str, Any]:
    """Extract the JSON report printed by ``loop --prepare``."""
    lines = stdout.splitlines()
    start = 0
    for i, line in enumerate(lines):
        if line.strip().startswith("{"):
            start = i
            break
    report: dict[str, Any] = json.loads("\n".join(lines[start:]))
    return report


def dispatch_manifest(manifest_path: Path, runner: str) -> None:
    """Invoke the configured runner with a manifest path."""
    print(f"  Dispatching {manifest_path.name} ...")
    subprocess.run([*shlex.split(runner), str(manifest_path)], check=True)


def run_cycle(
    project_dir: Path, dispatch: bool = False, max_iterations: int = 20
) -> int:
    """Run the parent-agent loop until completion, failure, or max iterations."""
    runner = os.environ.get("ELITE_AGENT_RUNNER")
    if not runner and not dispatch:
        print(
            "Note: ELITE_AGENT_RUNNER is not set and --dispatch is not used. "
            "The script will prepare manifests and print dispatch instructions.\n"
            "Set ELITE_AGENT_RUNNER to a command that accepts a manifest path, e.g.:\n"
            "  export ELITE_AGENT_RUNNER='python path/to/agent_runner.py'\n"
            "Or use --dispatch to print Agent tool call descriptions."
        )

    for iteration in range(1, max_iterations + 1):
        print(f"\n=== Parent-agent loop iteration {iteration} ===")

        # 1. Prepare: generate manifests and queue.
        prepare_args = ["loop", "--prepare"]
        if dispatch:
            prepare_args.append("--dispatch")
        prepare_result = run_orchestrator(project_dir, *prepare_args)
        print(prepare_result.stdout)
        if prepare_result.returncode != 0:
            print(prepare_result.stderr, file=sys.stderr)
            return prepare_result.returncode

        report = parse_prepare_report(prepare_result.stdout)
        agents = report.get("agents", [])
        tool_calls = report.get("tool_calls", [])
        if not agents:
            print("No agents dispatched; stopping.")
            return 0

        # 2. Dispatch each agent.
        if dispatch:
            print("\n=== Agent tool calls to invoke ===")
            print(json.dumps(tool_calls, indent=2))
            print(
                "\nInvoke each Agent tool call above, then run loop --complete."
            )
            return 0

        if runner:
            for entry in agents:
                manifest_path = project_dir / entry["manifest"]
                try:
                    dispatch_manifest(manifest_path, runner)
                except subprocess.CalledProcessError as exc:
                    print(
                        f"Agent runner failed for {manifest_path.name}: {exc}",
                        file=sys.stderr,
                    )
                    return exc.returncode
        else:
            print("Manifests ready for manual dispatch:")
            for entry in agents:
                print(f"  - {entry['agent']}: {entry['manifest']}")
            print("\nAfter dispatching each agent, run:")
            print(f"  python {ORCHESTRATOR} --project-dir {project_dir} loop --complete")
            return 0

        # 3. Complete: collect feedback, check gates, advance.
        complete_result = run_orchestrator(project_dir, "loop", "--complete")
        print(complete_result.stdout)
        if complete_result.returncode != 0:
            print(complete_result.stderr, file=sys.stderr)
            return complete_result.returncode

        complete_report = parse_prepare_report(complete_result.stdout)
        advanced_to = complete_report.get("advanced_to")
        blockers = complete_report.get("blockers", [])

        if advanced_to is None:
            print("\nCannot advance. Please resolve the blockers and re-run.")
            for blocker in blockers:
                print(f"  - {blocker}")
            return 1

        print(f"\nAdvanced to stage: {advanced_to}")
        if (
            advanced_to == "observe_improve"
            and complete_report.get("stage") == "observe_improve"
        ):
            print("Terminal loop reached. Stopping.")
            return 0

    print(f"Reached maximum iterations ({max_iterations}); stopping.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sample parent-agent runner for the Elite Agentic SDLC Pipeline"
    )
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=None,
        help="Project directory (default: example_project)",
    )
    parser.add_argument(
        "--dispatch",
        action="store_true",
        help="Print Agent tool call descriptions and stop for manual dispatch",
    )
    parser.add_argument(
        "--max-iterations",
        type=int,
        default=20,
        help="Maximum number of loop iterations (default: 20)",
    )
    args = parser.parse_args()

    project_dir = args.project_dir or (PROJECT_ROOT / "example_project")
    return run_cycle(
        project_dir.resolve(), dispatch=args.dispatch, max_iterations=args.max_iterations
    )


if __name__ == "__main__":
    sys.exit(main())
