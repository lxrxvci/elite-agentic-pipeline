# Elite Agentic SDLC Pipeline — Developer Makefile
.PHONY: help setup setup-pipeline setup-project setup-scaffold init run advance status check collect sync-scaffold advance-auto lint lint-pipeline lint-project lint-scaffold test test-pipeline test-project test-scaffold test-contracts-project test-contracts-scaffold test-e2e migrate infra-plan project-infra-plan ci ci-pipeline

PROJECT_DIR ?= example_project

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup-pipeline: ## Install pipeline developer dependencies into .venv
	python3 -m venv .venv
	source .venv/bin/activate && pip install -e ".[dev]"

setup-project: ## Install dependencies in the generated project (default: example_project)
	cd $(PROJECT_DIR)/src/backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
	cd $(PROJECT_DIR)/src/frontend && npm install

setup-scaffold: ## Install scaffold dependencies
	cd pipeline/platform/scaffold/backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
	cd pipeline/platform/scaffold/frontend && npm install

setup: setup-project ## Default setup targets the generated project

init: ## Initialize a new project from BRIEF env var (default: example_project)
	python3 pipeline/orchestrator.py --project-dir $(PROJECT_DIR) init --brief "$(BRIEF)"

run: ## Show current stage workflow and recommended agents
	python3 pipeline/orchestrator.py --project-dir $(PROJECT_DIR) run

advance: ## Advance project to next stage
	python3 pipeline/orchestrator.py --project-dir $(PROJECT_DIR) advance

status: ## Show project state
	python3 pipeline/orchestrator.py --project-dir $(PROJECT_DIR) status

check: ## Check CI feedback gates for the current stage
	python3 pipeline/orchestrator.py --project-dir $(PROJECT_DIR) check

collect: ## Refresh CI feedback gates for the current project
	cd $(PROJECT_DIR) && source src/backend/.venv/bin/activate && python3 scripts/ci_feedback.py --project-dir . --write-gates

sync-scaffold: ## Copy validated $(PROJECT_DIR) changes back into pipeline/platform/scaffold
	python3 pipeline/platform/sync_scaffold.py --project-dir $(PROJECT_DIR)

advance-auto: ## Advance project to next stage if CI feedback gates pass
	python3 pipeline/orchestrator.py --project-dir $(PROJECT_DIR) advance --auto

lint-pipeline: ## Run lint/typecheck on pipeline tooling
	source .venv/bin/activate && ruff check pipeline/
	source .venv/bin/activate && mypy pipeline/orchestrator.py pipeline/agent_runner.py pipeline/run_parent_agent.py

lint-project: ## Run lint/typecheck on the generated project
	cd $(PROJECT_DIR)/src/backend && source .venv/bin/activate && ruff check src tests
	cd $(PROJECT_DIR)/src/backend && source .venv/bin/activate && mypy src
	cd $(PROJECT_DIR)/src/frontend && npm run lint
	cd $(PROJECT_DIR)/src/frontend && npm run typecheck

lint-scaffold: ## Run lint/typecheck on scaffold code
	cd pipeline/platform/scaffold/backend && source .venv/bin/activate && ruff check src tests
	cd pipeline/platform/scaffold/backend && source .venv/bin/activate && mypy src
	cd pipeline/platform/scaffold/frontend && npm run lint
	cd pipeline/platform/scaffold/frontend && npm run typecheck

lint: lint-project ## Default lint targets the generated project

test-pipeline: ## Run pipeline orchestrator tests
	source .venv/bin/activate && pytest pipeline/tests/ -v

test-project: ## Run backend and frontend unit tests in the generated project
	cd $(PROJECT_DIR)/src/backend && source .venv/bin/activate && TEST_DATABASE_URL=sqlite:///./test.db pytest --ignore=tests/contracts --cov=src --cov-report=term-missing
	cd $(PROJECT_DIR)/src/frontend && npm run test:ci

test-contracts-project: ## Run Pact provider contract tests against a running backend
	cd $(PROJECT_DIR)/src/backend && source .venv/bin/activate && pytest tests/contracts/

test-scaffold: ## Run backend and frontend unit tests in the scaffold
	cd pipeline/platform/scaffold/backend && source .venv/bin/activate && TEST_DATABASE_URL=sqlite:///./test.db pytest --ignore=tests/contracts --cov=src --cov-report=term-missing
	cd pipeline/platform/scaffold/frontend && npm run test:ci

test-contracts-scaffold: ## Run Pact provider contract tests against a running scaffold backend
	cd pipeline/platform/scaffold/backend && source .venv/bin/activate && pytest tests/contracts/

test: test-project ## Default test targets the generated project

test-e2e: ## Run Playwright E2E tests in the generated project
	cd $(PROJECT_DIR)/src/frontend && npm run test:e2e

migrate: ## Run Alembic migrations in the generated project against DATABASE_URL
	cd $(PROJECT_DIR)/src/backend && source .venv/bin/activate && alembic upgrade head

infra-plan: ## Plan Terraform infrastructure for the pipeline platform module
	cd pipeline/platform/terraform && terraform plan -var="db_password=$${DB_PASSWORD:?required}"

project-infra-plan: ## Plan Terraform infrastructure inside a generated project
	cd $(PROJECT_DIR)/infra && terraform plan -var="db_password=$${DB_PASSWORD:?required}"

ci-pipeline: lint-pipeline test-pipeline ## Validate pipeline tooling
ci: lint test ## Local CI simulation for the generated project (lint + unit tests)
