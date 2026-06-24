# Elite Agentic — example_project local shortcuts
.PHONY: help setup lint typecheck test test-e2e migrate infra-plan ci deploy-local-backend deploy-local-frontend deploy-local-backend-prod deploy-local-frontend-prod

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

setup: ## Install backend and frontend dependencies
	cd src/backend && python3 -m venv .venv && source .venv/bin/activate && pip install -e ".[dev]"
	cd src/frontend && npm install

lint: ## Run lint on backend and frontend
	cd src/backend && source .venv/bin/activate && ruff check src tests
	cd src/backend && source .venv/bin/activate && mypy src
	cd src/frontend && npm run lint

typecheck: ## Run type checks on backend and frontend
	cd src/backend && source .venv/bin/activate && mypy src
	cd src/frontend && npm run typecheck

test: ## Run backend and frontend unit tests
	cd src/backend && source .venv/bin/activate && TEST_DATABASE_URL=sqlite:///./test.db pytest --ignore=tests/contracts --cov=src --cov-report=term-missing
	cd src/frontend && npm run test:ci

test-contracts: ## Run Pact provider contract tests against a running backend
	cd src/backend && source .venv/bin/activate && pytest tests/contracts/

test-e2e: ## Run Playwright E2E tests
	cd src/frontend && npm run test:e2e

migrate: ## Run Alembic migrations against DATABASE_URL
	cd src/backend && source .venv/bin/activate && alembic upgrade head

infra-plan: ## Plan Terraform infrastructure
	cd infra && terraform plan -var="db_password=$${DB_PASSWORD:?required}"

ci: lint typecheck test ## Local CI simulation

feedback: ## Aggregate CI feedback for the orchestrator
	python3 scripts/ci_feedback.py --project-dir . --write-gates

collect: feedback ## Refresh CI feedback gates and print orchestrator status
	python3 ../pipeline/orchestrator.py --project-dir . check

check: feedback ## Check current stage and CI feedback gates
	python3 ../pipeline/orchestrator.py --project-dir . check

advance-auto: ## Advance to next stage if CI feedback gates pass
	python3 ../pipeline/orchestrator.py --project-dir . advance --auto

deploy-local-backend: ## Deploy backend preview to Vercel using your local login
	scripts/deploy-local.sh backend

deploy-local-backend-prod: ## Deploy backend production to Vercel using your local login
	scripts/deploy-local.sh backend --prod

deploy-local-frontend: ## Deploy frontend preview to Vercel using your local login
	scripts/deploy-local.sh frontend

deploy-local-frontend-prod: ## Deploy frontend production to Vercel using your local login
	scripts/deploy-local.sh frontend --prod
