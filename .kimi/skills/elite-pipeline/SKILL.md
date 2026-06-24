# Elite Agentic SDLC Pipeline — Controller Skill

Use this skill to drive a project through the Elite Agentic SDLC Pipeline using the orchestrator CLI and the `Agent` tool.

## When to use

- The user wants to progress an SDLC stage (discovery → shaping → RFC/ADR → design/build → CI/CD → deploy/release → observe/improve).
- A project already exists with a `.pipeline/state.json` file.
- You have access to the `Agent` tool and can run shell commands in the project root.

## Prerequisites

- Project initialized: `python pipeline/orchestrator.py --project-dir <project-dir> init --brief "..."`
- Dependencies installed in the generated project (`make setup-project`).

## Parent-agent loop contract

The orchestrator is the single source of truth for the current stage and the agents that should act on it. As the parent agent, your job is to run the orchestrator, read its machine-readable output, dispatch subagents, and then tell the orchestrator the cycle is complete.

Repeat the following cycle until the stage reaches a terminal loop or the user asks you to stop.

### 1. Inspect state

```bash
python pipeline/orchestrator.py --project-dir <project-dir> status
```

Read `stage`, `history`, and `artifacts`.

### 2. Prepare agent dispatches

```bash
python pipeline/orchestrator.py --project-dir <project-dir> loop --prepare --dispatch
```

This:
- Clears stale pending manifests.
- Writes one manifest per agent for the current stage to `.pipeline/dispatch/<role>.md`.
- Writes `.pipeline/dispatch/queue.json`.
- Prints a JSON report with a `tool_calls` array, where each entry contains the full prompt and the expected `result_file` path.

Example `loop --prepare --dispatch` output:

```json
{
  "stage": "design_build",
  "agents": [
    {"agent": "ux_designer", "manifest": ".pipeline/dispatch/ux_designer.md"},
    {"agent": "backend_engineer", "manifest": ".pipeline/dispatch/backend_engineer.md"}
  ],
  "queue": ".pipeline/dispatch/queue.json",
  "action": "Invoke each Agent tool call, then run loop --complete. Each subagent should write its result to the corresponding result_file.",
  "tool_calls": [
    {
      "tool": "Agent",
      "description": "Design/build: ux_designer",
      "subagent_type": "coder",
      "prompt": "...",
      "manifest": ".pipeline/dispatch/ux_designer.md",
      "result_file": ".pipeline/dispatch/completed/ux_designer.json"
    },
    {
      "tool": "Agent",
      "description": "Design/build: backend_engineer",
      "subagent_type": "coder",
      "prompt": "...",
      "manifest": ".pipeline/dispatch/backend_engineer.md",
      "result_file": ".pipeline/dispatch/completed/backend_engineer.json"
    }
  ]
}
```

### 3. Dispatch each agent

For each entry in `tool_calls`, invoke the `Agent` tool with the manifest content as its prompt.

- Read the manifest file contents (or use the `prompt` field directly).
- Use `subagent_type="coder"` by default (agents produce code/docs).
- Set `description` to the value from `tool_calls`.
- Allow the subagent to read and write files inside `<project-dir>`.
- After the subagent finishes, write a result JSON to the `result_file` path:

```json
{
  "agent": "ux_designer",
  "status": "success",
  "summary": "Created wireframes and design tokens.",
  "artifacts_created": ["design/user-flows.md", "design-system/tokens.json"]
}
```

Example invocation pattern:

```
Agent(
  description="Discovery: product_strategist",
  subagent_type="coder",
  prompt=(read .pipeline/dispatch/product_strategist.md)
)
```

After all agents for the current stage have run and result files are written, continue to step 4.

### 4. Complete the cycle

```bash
python pipeline/orchestrator.py --project-dir <project-dir> loop --complete
```

This:
- Marks the pending manifests as completed.
- Checks that every dispatched agent has a corresponding result file.
- Refreshes CI feedback gates by running `scripts/ci_feedback.py --write-gates` if available.
- Parses workflow artifacts (`src/backend/.ci-feedback.json`, `src/frontend/.ci-feedback.json`, `.security-feedback.json`, `dora-metrics.prom`).
- Checks whether the current stage's gate is satisfied.
- Auto-advances to the next stage if gates pass.

Example `loop --complete` output:

```json
{
  "stage": "design_build",
  "can_advance": true,
  "blockers": [],
  "completed_manifests": [
    ".pipeline/dispatch/completed/ux_designer.md",
    ".pipeline/dispatch/completed/backend_engineer.md"
  ],
  "pending_results": [],
  "artifacts": {
    "backend": {"status": "collected", "path": "src/backend/.ci-feedback.json"},
    "frontend": {"status": "collected", "path": "src/frontend/.ci-feedback.json"},
    "security": {"status": "missing", "path": ".security-feedback.json"},
    "dora": {"status": "missing", "path": "dora-metrics.prom"},
    "gates": {"discovery": true, ..., "design_build": true}
  },
  "advanced_to": "ci_cd"
}
```

If `can_advance` is `false`, read the `blockers`, fix them (run tests, collect feedback, write missing result files, etc.), then re-run `loop --complete`. If `advanced_to` is set, return to step 2 for the new stage.

### 5. Stop condition

Stop when:
- The stage is `observe_improve` and has cycled at least once, **or**
- The user explicitly tells you to stop, **or**
- A gate has failed repeatedly and the user needs to make a product decision.

## Safety rules

- Do **not** use `loop --complete --force` to bypass failing gates unless the user explicitly approves it.
- Do **not** skip stages unless the user explicitly approves it.
- If a subagent produces artifacts, verify they exist before completing the cycle.
- If CI feedback is missing, run `python pipeline/orchestrator.py --project-dir <project-dir> collect` first.
- Always write a result file for each dispatched agent before running `loop --complete`.

## Manual overrides

- Force a stage transition: `python pipeline/orchestrator.py --project-dir <project-dir> advance --to <stage> --force`
- Check gates without advancing: `python pipeline/orchestrator.py --project-dir <project-dir> check`
- Refresh feedback: `python pipeline/orchestrator.py --project-dir <project-dir> collect`
- Override gate failure on complete: `python pipeline/orchestrator.py --project-dir <project-dir> loop --complete --force`

## Example session

```bash
python pipeline/orchestrator.py --project-dir example_project status
python pipeline/orchestrator.py --project-dir example_project loop --prepare --dispatch
# invoke each agent from tool_calls using the Agent tool
python pipeline/orchestrator.py --project-dir example_project loop --complete
```

## Sample runner

A reference implementation of this parent-agent loop is provided in `pipeline/run_parent_agent.py`. It can be used as a starting point for environments where subagent dispatch can be scripted:

```bash
python pipeline/run_parent_agent.py --project-dir example_project
```

By default it prepares manifests and prints the `tool_calls` array so you can invoke each agent manually. Set `ELITE_AGENT_RUNNER` to use an external runner for each manifest.
