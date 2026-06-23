#!/usr/bin/env python3
"""Reference agent runner for the Elite Agentic SDLC Pipeline.

The orchestrator's `execute` command invokes this script (or any command set in
`ELITE_AGENT_RUNNER`) for each pending dispatch manifest. In a Kimi Code CLI
runtime, replace this reference with a runner that calls the `Agent` tool with
the manifest content as its prompt.

Usage:
    ELITE_AGENT_RUNNER="python pipeline/agent_runner.py" \
        python pipeline/orchestrator.py --project-dir example_project execute

Or directly:
    python pipeline/agent_runner.py example_project/.pipeline/dispatch/product_strategist.md
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def run_manifest(manifest_path: Path) -> int:
    if not manifest_path.exists():
        print(f"ERROR: manifest not found: {manifest_path}", file=sys.stderr)
        return 1

    content = manifest_path.read_text(encoding="utf-8")
    agent = manifest_path.stem

    # Emit a structured record that an external driver can consume to invoke the
    # real Agent tool.
    record = {
        "agent": agent,
        "manifest": str(manifest_path),
        "prompt_length": len(content),
    }
    print(json.dumps(record))
    print(f"\n=== Executing agent: {agent} ===")
    print(f"Manifest: {manifest_path}")
    print("\nIn a Kimi Code CLI runtime, pass the manifest content to the Agent tool.")
    print("Reference runner completed successfully.")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <manifest-path>", file=sys.stderr)
        return 1
    return run_manifest(Path(sys.argv[1]))


if __name__ == "__main__":
    sys.exit(main())
