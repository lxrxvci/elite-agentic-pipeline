#!/usr/bin/env python3
"""
Elite Agentic SDLC Pipeline Orchestrator

This driver manages project state and guides the agent squad through the
continuous delivery loop. It is designed to run inside Kimi Code CLI, where
agents can be dispatched via the Agent tool.
"""

import argparse
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = PIPELINE_DIR.parent
PLATFORM_DIR = PIPELINE_DIR / "platform"
AGENTS_DIR = PIPELINE_DIR / "agents"
WORKFLOWS_DIR = PIPELINE_DIR / "workflows"
TEMPLATES_DIR = PIPELINE_DIR / "templates"

# Directories and files that must never be copied from the scaffold because they
# are build outputs, dependency caches, or environment-specific artifacts.
SCAFFOLD_SKIP = {
    ".venv",
    "venv",
    "node_modules",
    ".next",
    "out",
    "dist",
    "build",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".coverage",
    "coverage",
    "htmlcov",
    "test-results",
    "playwright-report",
    "playwright",
    ".git",
    ".DS_Store",
    "__pycache__",
    "*.pyc",
    "*.pyo",
    "*.egg-info",
    "*.tsbuildinfo",
    "test.db",
    "*.log",
}


def load_state(project_dir: Path) -> dict:
    state_file = project_dir / ".pipeline" / "state.json"
    if state_file.exists():
        return json.loads(state_file.read_text())
    return {"stage": "init", "artifacts": [], "history": []}


def save_state(project_dir: Path, state: dict) -> None:
    state_file = project_dir / ".pipeline" / "state.json"
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state, indent=2))


def log(project_dir: Path, message: str) -> None:
    log_file = project_dir / ".pipeline" / "orchestrator.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now(timezone.utc).isoformat()
    with log_file.open("a") as f:
        f.write(f"[{timestamp}] {message}\n")


def slugify(text: str) -> str:
    """Convert a brief into a safe directory name."""
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9\s-]", "", text)
    text = re.sub(r"[\s-]+", "_", text)
    return text[:50] or "project"


def _skip_dir(name: str) -> bool:
    """Return True if a directory should not be copied from the scaffold."""
    return name in SCAFFOLD_SKIP or name.endswith(".egg-info")


def _skip_file(name: str) -> bool:
    """Return True if a file should not be copied from the scaffold."""
    if name in SCAFFOLD_SKIP:
        return True
    return (
        name.endswith(".pyc")
        or name.endswith(".pyo")
        or name.endswith(".tsbuildinfo")
        or name.endswith(".log")
        or name == ".coverage"
        or name == "test.db"
    )


def copy_scaffold(target_dir: Path) -> None:
    """Copy the Golden Path scaffold into the target project.

    Only source files, configuration, and lockfiles are copied. Dependency
    directories and build artifacts are excluded and must be installed by the
    post-init setup commands documented in README.md.
    """
    scaffold_dir = PLATFORM_DIR / "scaffold"
    for subdir in ["frontend", "backend", "database"]:
        src = scaffold_dir / subdir
        dst = target_dir / "src" / subdir
        if not src.exists():
            continue
        for root, dirs, files in os.walk(src):
            rel_root = Path(root).relative_to(src)
            # Prune skipped directories in-place so os.walk does not descend.
            dirs[:] = [d for d in dirs if not _skip_dir(d)]
            for file in files:
                if _skip_file(file):
                    continue
                src_file = Path(root) / file
                dst_file = dst / rel_root / file
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dst_file)

    # Copy top-level test/perf and other project-level directories
    for subdir in ["tests", "observability", "scripts"]:
        src = scaffold_dir / subdir
        dst = target_dir / subdir
        if not src.exists():
            continue
        for root, dirs, files in os.walk(src):
            rel_root = Path(root).relative_to(src)
            # Prune skipped directories in-place so os.walk does not descend.
            dirs[:] = [d for d in dirs if not _skip_dir(d)]
            for file in files:
                if _skip_file(file):
                    continue
                src_file = Path(root) / file
                dst_file = dst / rel_root / file
                dst_file.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_file, dst_file)

    design_src = PLATFORM_DIR / "design_system"
    design_dst = target_dir / "design-system"
    if design_src.exists():
        shutil.copytree(design_src, design_dst, dirs_exist_ok=True)

    # Copy GitHub Actions workflows and Dependabot config
    github_src = scaffold_dir / ".github"
    github_dst = target_dir / ".github"
    if github_src.exists():
        shutil.copytree(github_src, github_dst, dirs_exist_ok=True)

    # Copy root config files (gitignore, env example, docker-compose, deploy configs, etc.)
    for config_file in [
        ".gitignore",
        ".env.example",
        "docker-compose.yml",
        "fly.toml",
        "vercel.json",
        "catalog-info.yaml",
    ]:
        src = scaffold_dir / config_file
        if src.exists():
            shutil.copy2(src, target_dir / config_file)

    # Copy Terraform module into generated projects as infra/
    infra_src = PLATFORM_DIR / "terraform"
    infra_dst = target_dir / "infra"
    if infra_src.exists():
        shutil.copytree(infra_src, infra_dst, dirs_exist_ok=True)


def copy_template(template_name: str, target_path: Path) -> None:
    """Copy a template file from pipeline/templates into the project."""
    src = TEMPLATES_DIR / template_name
    if not src.exists():
        return
    target_path.parent.mkdir(parents=True, exist_ok=True)
    target_path.write_text(src.read_text())


def seed_required_artifacts(target_dir: Path) -> None:
    """Seed required security, SRE, and quality artifacts from templates."""
    copy_template("getting_started.md", target_dir / "GETTING_STARTED.md")
    copy_template("threat_model.md", target_dir / "docs" / "THREAT_MODEL.md")
    copy_template("metrics.md", target_dir / "METRICS.md")
    copy_template("slos.md", target_dir / "docs" / "SLOs.md")
    copy_template("test_strategy.md", target_dir / "docs" / "TEST_STRATEGY.md")
    copy_template("runbook_oncall.md", target_dir / "docs" / "RUNBOOKS" / "oncall.md")
    copy_template(
        "runbook_incident_response.md",
        target_dir / "docs" / "RUNBOOKS" / "incident-response.md",
    )
    copy_template("runbook_rollback.md", target_dir / "docs" / "RUNBOOKS" / "rollback.md")
    copy_template("runbook_game_day.md", target_dir / "docs" / "RUNBOOKS" / "game-day.md")
    (target_dir / "docs" / "post-mortems").mkdir(exist_ok=True)
    copy_template(
        "post_mortem.md",
        target_dir / "docs" / "post-mortems" / "template.md",
    )


def validate_advance(project_dir: Path, current: str, next_stage: str) -> None:
    """Enforce lightweight exit criteria before advancing stages."""
    errors = []

    stages_after_rfc = {"design_build", "ci_cd", "deploy_release", "observe_improve"}
    stages_after_design = {"ci_cd", "deploy_release", "observe_improve"}
    stages_after_ci = {"deploy_release", "observe_improve"}

    if next_stage in stages_after_rfc:
        if not (project_dir / "openapi.yaml").exists():
            errors.append("openapi.yaml is required before advancing past RFC/ADR.")

        adr_dir = project_dir / "docs" / "adr"
        if adr_dir.exists():
            for adr_file in adr_dir.glob("*.md"):
                content = adr_file.read_text(encoding="utf-8")
                if "## Status" in content and "- Accepted" not in content and "- Proposed" in content:
                    errors.append(f"ADR {adr_file.name} is still Proposed. Accept or reject it first.")
        else:
            errors.append("docs/adr/ directory is missing. At least one accepted ADR is required.")

        if not (project_dir / "docs" / "SHAPED_BETS.md").exists():
            errors.append("docs/SHAPED_BETS.md is required before advancing to design/build.")

    if next_stage in stages_after_design:
        if not (project_dir / "docs" / "THREAT_MODEL.md").exists():
            errors.append("docs/THREAT_MODEL.md is required before advancing to CI/CD.")

        if not (project_dir / "docs" / "TEST_STRATEGY.md").exists():
            errors.append("docs/TEST_STRATEGY.md is required before advancing to CI/CD.")

        if not (project_dir / "src" / "backend" / "tests").exists():
            errors.append("Backend tests are required before advancing to CI/CD.")

    if next_stage in stages_after_ci:
        if not (project_dir / ".github" / "workflows" / "deploy.yml").exists():
            errors.append("Deploy workflow is missing. Run CI/CD setup first.")

    if next_stage == "observe_improve":
        if not (project_dir / "METRICS.md").exists():
            errors.append("METRICS.md is required before advancing to observe/improve.")

        if not (project_dir / "docs" / "SLOs.md").exists():
            errors.append("docs/SLOs.md is required before advancing to observe/improve.")

    if errors:
        print("\nCannot advance stage. Please resolve the following:\n", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        sys.exit(1)


def init_project(brief: str, target_dir: Path | None = None) -> Path:
    if target_dir is None:
        target_dir = PROJECT_ROOT / "example_project"

    target_dir.mkdir(parents=True, exist_ok=True)
    (target_dir / "BRIEF.md").write_text(f"# Product Brief\n\n{brief}\n")

    # Seed initial docs
    docs_dir = target_dir / "docs"
    docs_dir.mkdir(parents=True, exist_ok=True)
    (docs_dir / "adr").mkdir(exist_ok=True)
    (docs_dir / "rfc").mkdir(exist_ok=True)
    (docs_dir / "RUNBOOKS").mkdir(exist_ok=True)

    discovery_dir = target_dir / "DISCOVERY"
    discovery_dir.mkdir(exist_ok=True)
    (discovery_dir / "OST.md").write_text("# Opportunity Solution Tree\n\n*Outcomes → Opportunities → Solutions → Experiments*\n")
    (discovery_dir / "ASSUMPTIONS.md").write_text("# Riskiest Assumptions\n\n*List assumptions ranked by impact and uncertainty.*\n")
    (discovery_dir / "INTERVIEW_NOTES").mkdir(exist_ok=True)

    copy_scaffold(target_dir)
    seed_required_artifacts(target_dir)

    state = {
        "stage": "discovery",
        "brief": brief,
        "artifacts": [
            "BRIEF.md",
            "GETTING_STARTED.md",
            "DISCOVERY/OST.md",
            "DISCOVERY/ASSUMPTIONS.md",
            "DISCOVERY/INTERVIEW_NOTES/",
            "docs/adr/",
            "docs/rfc/",
            "docs/THREAT_MODEL.md",
            "docs/SLOs.md",
            "docs/TEST_STRATEGY.md",
            "docs/RUNBOOKS/",
            "docs/post-mortems/",
            "METRICS.md",
            "src/frontend/",
            "src/backend/",
            "src/database/",
            "design-system/",
            ".github/workflows/",
            "docker-compose.yml",
            "infra/",
        ],
        "history": [{"stage": "init", "at": datetime.now(timezone.utc).isoformat()}],
    }
    save_state(target_dir, state)
    log(target_dir, "Project initialized")

    return target_dir


def stage_workflow(stage: str) -> str:
    mapping = {
        "discovery": "discovery_loop.md",
        "shaping": "shaping.md",
        "rfc_adr": "rfc_adr.md",
        "design_build": "design_build.md",
        "ci_cd": "ci_cd.md",
        "deploy_release": "deploy_release.md",
        "observe_improve": "observe_improve.md",
    }
    return mapping.get(stage, "discovery_loop.md")


# Single source of truth for which agents participate in each stage.
STAGE_AGENTS: dict[str, list[str]] = {
    "discovery": ["product_strategist", "ux_researcher", "tech_lead"],
    "shaping": ["product_strategist", "tech_lead", "product_owner"],
    "rfc_adr": ["tech_lead", "tpm", "security_champion"],
    "design_build": [
        "ux_designer",
        "ui_technologist",
        "frontend_engineer",
        "backend_engineer",
        "sdet",
        "security_champion",
        "designops",
    ],
    "ci_cd": ["devops_sre", "sdet", "platform_engineer", "appsec_engineering", "qa_enablement"],
    "deploy_release": ["devops_sre", "product_owner", "data_analyst", "sre_platform"],
    "observe_improve": [
        "data_analyst",
        "devops_sre",
        "product_strategist",
        "ux_researcher",
        "sre_platform",
    ],
}


def next_agent(stage: str) -> str:
    agents = STAGE_AGENTS.get(stage, ["product_strategist"])
    return ", ".join(a.replace("_", " ").title() for a in agents)


def collect_feedback(project_dir: Path) -> str:
    """Aggregate CI/test/metric signals into agent-readable context."""
    feedback_parts = []

    feedback_json = project_dir / ".pipeline" / "feedback.json"
    if feedback_json.exists():
        feedback_parts.append("## Collected Feedback\n")
        feedback_parts.append(feedback_json.read_text())
        feedback_parts.append("\n")

    metrics_file = project_dir / "dora-metrics.prom"
    if metrics_file.exists():
        feedback_parts.append("## DORA Metrics\n")
        feedback_parts.append(metrics_file.read_text())
        feedback_parts.append("\n")

    return "\n".join(feedback_parts)


def build_agent_context(project_dir: Path, agent_name: str) -> str:
    """Build the full context block passed to an agent prompt."""
    state = load_state(project_dir)
    stage = state.get("stage", "discovery")
    brief = (project_dir / "BRIEF.md").read_text() if (project_dir / "BRIEF.md").exists() else "No brief found."
    workflow_file = WORKFLOWS_DIR / stage_workflow(stage)
    workflow = workflow_file.read_text() if workflow_file.exists() else "No workflow found."
    feedback = collect_feedback(project_dir)

    artifacts = []
    for artifact in state.get("artifacts", []):
        artifact_path = project_dir / artifact
        if artifact_path.exists():
            artifacts.append(artifact)

    return f"""# Project Context

**Project directory:** {project_dir}
**Current stage:** {stage}
**Agent role:** {agent_name.replace("_", " ").title()}

## Brief

{brief}

## Active Workflow

{workflow}

## Existing Artifacts

{chr(10).join(f"- {a}" for a in artifacts) or "None yet."}

{feedback}
"""


def dispatch_agent(project_dir: Path, agent_name: str, auto: bool = False) -> Path | None:
    """Generate a dispatch manifest for the requested agent.

    In auto mode the manifest is written to .pipeline/dispatch/ and a path is
    returned. In manual mode the invocation is printed to stdout.
    """
    agent_file = AGENTS_DIR / f"{agent_name}.md"
    if not agent_file.exists():
        print(f"Agent prompt not found: {agent_file}", file=sys.stderr)
        return None

    prompt = agent_file.read_text()
    context = build_agent_context(project_dir, agent_name)
    full_prompt = f"{context}\n\n# Agent Prompt\n\n{prompt}"

    if auto:
        dispatch_dir = project_dir / ".pipeline" / "dispatch"
        dispatch_dir.mkdir(parents=True, exist_ok=True)
        manifest_path = dispatch_dir / f"{agent_name}.md"
        manifest_path.write_text(full_prompt)
        log(project_dir, f"Dispatched agent {agent_name} -> {manifest_path}")
        return manifest_path

    print(f"\n=== Agent Dispatch: {agent_name} ===\n")
    print(full_prompt)
    print("\n--- End Dispatch ---\n")
    return None


def run_dispatch_queue(project_dir: Path) -> None:
    """Process pending agent dispatch manifests."""
    dispatch_dir = project_dir / ".pipeline" / "dispatch"
    if not dispatch_dir.exists():
        print("No pending agent dispatches.")
        return

    pending = sorted(dispatch_dir.glob("*.md"))
    if not pending:
        print("No pending agent dispatches.")
        return

    print(f"\nProcessing {len(pending)} pending agent dispatch(es):\n")
    for manifest in pending:
        print(f"- {manifest.name}")
        # In a fully agentic runtime this is where the Agent tool would be invoked.
        # For now the manifest remains available for manual or wrapper-driven execution.
    print(f"\nManifests are ready in: {dispatch_dir}")


def run_stage(project_dir: Path, auto: bool = False) -> None:
    state = load_state(project_dir)
    stage = state.get("stage", "discovery")
    workflow_file = WORKFLOWS_DIR / stage_workflow(stage)

    print(f"\n=== Elite Agentic Pipeline :: Stage: {stage} ===\n")
    print(f"Next agents: {next_agent(stage)}")
    print(f"Workflow: {workflow_file}\n")

    if workflow_file.exists():
        print(workflow_file.read_text())
    else:
        print("[No workflow file found]")

    print("\n--- Recommended Agent Invocations ---\n")

    for agent_name in STAGE_AGENTS.get(stage, ["product_strategist"]):
        agent_file = AGENTS_DIR / f"{agent_name}.md"
        print(f"Agent: {agent_name}")
        print(f"Prompt source: {agent_file}")
        if auto:
            manifest = dispatch_agent(project_dir, agent_name, auto=True)
            if manifest:
                print(f"Dispatched manifest: {manifest}")
        else:
            print(f"Suggested call: dispatch_agent('{agent_name}', project_dir='{project_dir}')\n")


def advance(
    project_dir: Path,
    next_stage: str | None = None,
    auto: bool = False,
) -> None:
    state = load_state(project_dir)
    current = state.get("stage", "discovery")

    flow = [
        "discovery",
        "shaping",
        "rfc_adr",
        "design_build",
        "ci_cd",
        "deploy_release",
        "observe_improve",
    ]

    if next_stage:
        if next_stage not in flow:
            print(f"Unknown stage: {next_stage}", file=sys.stderr)
            sys.exit(1)
    elif current in flow:
        idx = flow.index(current)
        if idx + 1 < len(flow):
            next_stage = flow[idx + 1]
        else:
            next_stage = "observe_improve"  # continuous loop
    else:
        next_stage = "discovery"

    if auto:
        passed, blockers = check_stage_gates(project_dir)
        if not passed:
            print("\nCannot auto-advance. Please resolve the following:\n", file=sys.stderr)
            for blocker in blockers:
                print(f"  - {blocker}", file=sys.stderr)
            sys.exit(1)

    validate_advance(project_dir, current, next_stage)

    state["stage"] = next_stage
    state["history"].append({"stage": state["stage"], "at": datetime.now(timezone.utc).isoformat()})
    save_state(project_dir, state)
    log(project_dir, f"Advanced to stage: {state['stage']}")
    print(f"Advanced to stage: {state['stage']}")


def status(project_dir: Path) -> None:
    state = load_state(project_dir)
    print(json.dumps(state, indent=2))


def load_feedback_gates(project_dir: Path) -> dict[str, bool]:
    """Load per-stage gate status from CI feedback, if available."""
    gates_file = project_dir / ".pipeline" / "gates.json"
    if gates_file.exists():
        return json.loads(gates_file.read_text())

    feedback_file = project_dir / ".pipeline" / "feedback.json"
    if feedback_file.exists():
        feedback = json.loads(feedback_file.read_text())
        return feedback.get("gates", {})

    return {}


def check_stage_gates(project_dir: Path) -> tuple[bool, list[str]]:
    """Check whether the current stage's exit criteria are satisfied.

    Returns (all_passed, list of blocking items).
    """
    state = load_state(project_dir)
    stage = state.get("stage", "discovery")
    gates = load_feedback_gates(project_dir)
    blockers: list[str] = []

    # Map stage to the gate that must be open before advancing out of it.
    required_gates = {
        "discovery": None,
        "shaping": None,
        "rfc_adr": None,
        "design_build": "design_build",
        "ci_cd": "ci_cd",
        "deploy_release": "deploy_release",
        "observe_improve": "observe_improve",
    }

    required = required_gates.get(stage)
    if required and not gates.get(required, False):
        blockers.append(f"Gate '{required}' is not satisfied (run CI and scripts/ci_feedback.py)")

    return (not blockers, blockers)


def check(project_dir: Path) -> None:
    """Report current stage and gate status."""
    state = load_state(project_dir)
    stage = state.get("stage", "discovery")
    gates = load_feedback_gates(project_dir)
    passed, blockers = check_stage_gates(project_dir)

    report = {
        "stage": stage,
        "gates": gates,
        "can_advance": passed,
        "blockers": blockers,
    }
    print(json.dumps(report, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Elite Agentic SDLC Pipeline Orchestrator")
    parser.add_argument(
        "--project-dir",
        type=Path,
        default=None,
        help="Project directory (default: example_project)",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser("init", help="Initialize a new project from a brief")
    init_parser.add_argument("--brief", required=True, help="Product brief")

    run_parser = subparsers.add_parser("run", help="Show current stage workflow and recommended agents")
    run_parser.add_argument("--auto", action="store_true", help="Generate agent dispatch manifests")

    advance_parser = subparsers.add_parser("advance", help="Advance to the next stage")
    advance_parser.add_argument("--to", dest="next_stage", help="Target stage")
    advance_parser.add_argument(
        "--auto",
        action="store_true",
        help="Only advance if CI feedback gates are satisfied",
    )

    subparsers.add_parser("dispatch", help="Process pending agent dispatch queue")

    subparsers.add_parser("status", help="Show project state")

    subparsers.add_parser("check", help="Check current stage and CI feedback gates")

    args = parser.parse_args()

    if args.command == "init":
        project_dir = args.project_dir
        if project_dir is None:
            project_dir = PROJECT_ROOT / slugify(args.brief)
        project_dir = init_project(args.brief, project_dir)
        print(f"Initialized project at: {project_dir}")
        print("Next: run `python pipeline/orchestrator.py --project-dir", project_dir, "run`")
        return

    project_dir = args.project_dir or (PROJECT_ROOT / "example_project")

    if args.command == "run":
        run_stage(project_dir, auto=args.auto)
    elif args.command == "advance":
        advance(project_dir, args.next_stage, auto=args.auto)
    elif args.command == "dispatch":
        run_dispatch_queue(project_dir)
    elif args.command == "status":
        status(project_dir)
    elif args.command == "check":
        check(project_dir)


if __name__ == "__main__":
    main()
