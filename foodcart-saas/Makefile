# Foodcart SaaS — local CI simulation
#
# Usage:
#   make ci        # run lint/type/test/security checks and aggregate feedback
#   make backend   # backend-only checks
#   make frontend  # frontend-only checks
#   make clean     # remove generated feedback and coverage artifacts

.PHONY: ci backend frontend clean

PYTHON ?= python3

backend:
	$(PYTHON) scripts/ci_feedback.py --project-dir . --write-gates

frontend:
	$(PYTHON) scripts/ci_feedback.py --project-dir . --write-gates

contract-tests:
	cd src/frontend && npm run test:contracts
	cd src/backend && .venv/bin/pytest tests/contracts/

e2e-tests:
	cd src/frontend && npm run test:e2e:real

ci:
	$(PYTHON) scripts/ci_feedback.py --project-dir . --write-gates --force

clean:
	rm -f src/backend/.ci-feedback.json src/frontend/.ci-feedback.json
	rm -f .pipeline/feedback.json .pipeline/gates.json
	rm -rf src/backend/htmlcov src/frontend/coverage
