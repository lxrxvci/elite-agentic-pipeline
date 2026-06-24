"""Unit tests for the pipeline orchestrator."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

CaptureFixture = pytest.CaptureFixture


def _extract_json(captured_out: str) -> dict:
    """Extract the final JSON object printed by the orchestrator."""
    lines = captured_out.splitlines()
    # Find the first line that starts the final JSON object and concatenate
    # everything from there to the end.
    start = 0
    for i, line in enumerate(lines):
        if line.strip().startswith("{"):
            start = i
            break
    return json.loads("\n".join(lines[start:]))

# Ensure the orchestrator module is importable from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from orchestrator import (  # noqa: E402
    allowed_next_stages,
    load_state,
    loop,
    save_state,
    slugify,
    stage_index,
)


class TestStageFlow:
    def test_stage_index_known_stages(self) -> None:
        assert stage_index("init") == 0
        assert stage_index("discovery") == 1
        assert stage_index("observe_improve") == 7

    def test_stage_index_unknown_stage(self) -> None:
        assert stage_index("unknown") == -1

    def test_allowed_next_stages_linear(self) -> None:
        assert allowed_next_stages("discovery") == {"shaping"}
        assert allowed_next_stages("shaping") == {"rfc_adr"}
        assert allowed_next_stages("deploy_release") == {"observe_improve"}

    def test_allowed_next_stages_terminal(self) -> None:
        # Terminal stage loops back to itself.
        assert allowed_next_stages("observe_improve") == {"observe_improve"}

    def test_allowed_next_stages_unknown(self) -> None:
        assert allowed_next_stages("unknown") == set()


class TestSlugify:
    def test_slugify_normal_text(self) -> None:
        assert slugify("A SaaS dashboard for freelancers") == "a_saas_dashboard_for_freelancers"

    def test_slugify_special_chars(self) -> None:
        assert slugify("Elite & Agentic! Pipeline v2.0") == "elite_agentic_pipeline_v20"

    def test_slugify_empty_fallback(self) -> None:
        assert slugify("!!!") == "project"


class TestLoopCommand:
    """Tests for the agentic loop driver."""

    @pytest.fixture
    def project_dir(self, tmp_path: Path) -> Path:
        """Create a minimal project directory with a pipeline state."""
        project = tmp_path / "project"
        project.mkdir()
        pipeline_dir = project / ".pipeline"
        pipeline_dir.mkdir()
        save_state(
            project,
            {
                "stage": "discovery",
                "brief": "Test brief",
                "artifacts": [],
                "history": [{"stage": "init", "at": "2026-06-23T00:00:00Z"}],
            },
        )
        return project

    def test_loop_prepare_writes_manifests_and_queue(
        self, project_dir: Path, capsys: CaptureFixture
    ) -> None:
        loop(project_dir, prepare=True)

        dispatch_dir = project_dir / ".pipeline" / "dispatch"
        queue_file = dispatch_dir / "queue.json"
        assert queue_file.exists()

        queue = json.loads(queue_file.read_text())
        agent_names = {entry["agent"] for entry in queue}
        assert agent_names == {"product_strategist", "ux_researcher", "tech_lead"}

        for entry in queue:
            manifest_path = project_dir / entry["manifest"]
            assert manifest_path.exists()

        captured = capsys.readouterr()
        report = _extract_json(captured.out)
        assert report["stage"] == "discovery"
        assert len(report["agents"]) == 3
        assert report["queue"] == ".pipeline/dispatch/queue.json"

    def test_loop_prepare_clears_stale_manifests(self, project_dir: Path) -> None:
        dispatch_dir = project_dir / ".pipeline" / "dispatch"
        stale = dispatch_dir / "stale.md"
        stale.parent.mkdir(parents=True, exist_ok=True)
        stale.write_text("stale")

        loop(project_dir, prepare=True)

        assert not stale.exists()

    def test_loop_prepare_dispatch_includes_tool_calls(
        self, project_dir: Path, capsys: CaptureFixture
    ) -> None:
        loop(project_dir, prepare=True, dispatch=True)

        captured = capsys.readouterr()
        report = _extract_json(captured.out)
        assert "tool_calls" in report
        assert len(report["tool_calls"]) == len(report["agents"])
        for call in report["tool_calls"]:
            assert call["tool"] == "Agent"
            assert call["subagent_type"] == "coder"
            assert "prompt" in call
            assert "manifest" in call
            assert "result_file" in call

    def _seed_advance_artifacts(self, project_dir: Path) -> None:
        """Create the artifacts required to advance past RFC/ADR."""
        (project_dir / "openapi.yaml").write_text("openapi: 3.0.0")

        adr_dir = project_dir / "docs" / "adr"
        adr_dir.mkdir(parents=True)
        (adr_dir / "0001-accepted.md").write_text("## Status\n\n- Accepted\n")

        (project_dir / "docs" / "SHAPED_BETS.md").write_text("# Bets")
        (project_dir / "docs" / "THREAT_MODEL.md").write_text("# Threats")
        (project_dir / "docs" / "TEST_STRATEGY.md").write_text("# Tests")
        (project_dir / "src" / "backend" / "tests").mkdir(parents=True)

    def test_loop_complete_advances_when_gates_pass(
        self, project_dir: Path, capsys: CaptureFixture
    ) -> None:
        save_state(project_dir, {"stage": "design_build", "artifacts": [], "history": []})
        self._seed_advance_artifacts(project_dir)
        (project_dir / ".pipeline" / "gates.json").write_text(
            json.dumps({"design_build": True})
        )

        loop(project_dir, complete=True)

        state = load_state(project_dir)
        assert state["stage"] == "ci_cd"

        captured = capsys.readouterr()
        report = _extract_json(captured.out)
        assert report["can_advance"] is True
        assert report["advanced_to"] == "ci_cd"

    def test_loop_complete_blocks_when_gates_fail(
        self, project_dir: Path, capsys: CaptureFixture
    ) -> None:
        save_state(project_dir, {"stage": "design_build", "artifacts": [], "history": []})
        self._seed_advance_artifacts(project_dir)
        (project_dir / ".pipeline" / "gates.json").write_text(
            json.dumps({"design_build": False})
        )

        loop(project_dir, complete=True)

        state = load_state(project_dir)
        assert state["stage"] == "design_build"

        captured = capsys.readouterr()
        report = _extract_json(captured.out)
        assert report["can_advance"] is False
        assert report["advanced_to"] is None
        assert any("design_build" in b for b in report["blockers"])

    def test_loop_complete_force_advances_past_failed_gate(
        self, project_dir: Path, capsys: CaptureFixture
    ) -> None:
        save_state(project_dir, {"stage": "design_build", "artifacts": [], "history": []})
        self._seed_advance_artifacts(project_dir)
        (project_dir / ".pipeline" / "gates.json").write_text(
            json.dumps({"design_build": False})
        )

        loop(project_dir, complete=True, force=True)

        state = load_state(project_dir)
        assert state["stage"] == "ci_cd"

        captured = capsys.readouterr()
        report = _extract_json(captured.out)
        assert report["can_advance"] is False
        assert report["forced"] is True
        assert report["advanced_to"] == "ci_cd"

    def test_loop_complete_parses_workflow_artifacts(
        self, project_dir: Path, capsys: CaptureFixture
    ) -> None:
        save_state(project_dir, {"stage": "ci_cd", "artifacts": [], "history": []})
        backend = project_dir / "src" / "backend"
        backend.mkdir(parents=True)
        (backend / ".ci-feedback.json").write_text(
            json.dumps(
                {
                    "checks": {
                        "lint": {"passed": True},
                        "typecheck": {"passed": True},
                        "bandit": {"passed": True},
                    }
                }
            )
        )
        frontend = project_dir / "src" / "frontend"
        frontend.mkdir(parents=True)
        (frontend / ".ci-feedback.json").write_text(
            json.dumps(
                {
                    "checks": {
                        "lint": {"passed": True},
                        "typecheck": {"passed": True},
                    }
                }
            )
        )

        loop(project_dir, complete=True)

        captured = capsys.readouterr()
        report = _extract_json(captured.out)
        assert report["artifacts"]["backend"]["status"] == "collected"
        assert report["artifacts"]["frontend"]["status"] == "collected"
        assert report["artifacts"]["security"]["status"] == "missing"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
