# Golden Paths — Foodcart SaaS

The safest, most compliant way is the easiest way. These Golden Paths describe
the default route for common changes in the Foodcart SaaS codebase. Deviations
are allowed, but they require explicit design review and updated threat-model
or ADR coverage.

All paths consume the reusable Elite platform CI/CD workflows in
`../pipeline/platform/github_actions/` (relative to this project). Squad-specific
instances live in `.github/workflows/` and are maintained by DevOps/SRE.

## 1. Adding a new public-site template

### Goal

Add a new visual theme (e.g. a fourth reference design) that business owners can
select during onboarding and that renders the standard content block schema.

### Golden Path

1. **Design review**
   - Confirm the new template covers the seven required sections: hero, story,
     menu, locations/hours, catering, contact, order links, footer.
   - Add the reference-design assets to `design-system/` and update
     `docs/DESIGN_SYSTEM_GOVERNANCE.md` with color, typography, and motion
     tokens.

2. **Backend contract**
   - Add the new `template_id` value to the `TemplateId` enum in
     `src/backend/src/app/schemas_foodcart.py`.
   - Add an Alembic migration only if the database needs to persist the new
     template ID in a constrained column.
   - Ensure the public site API (`GET /public/sites/{slug}`) returns the
     `template_id` unchanged; the backend does **not** encode template-specific
     rendering logic.

3. **Frontend rendering**
   - Register the template in `src/frontend/src/features/public-site/lib/templates.ts`.
   - Create section components under
     `src/frontend/src/features/public-site/ui/templates/{template_id}/`.
   - Map `(block_type, template_id)` to the section component in the template
     registry. Reuse shared UI primitives from `src/frontend/src/shared/ui/`.

4. **Admin UX**
   - Add a thumbnail to `src/frontend/public/templates/`.
   - Update `TemplateSelector.tsx` to include the new option.

5. **Tests & coverage**
   - Add unit tests for the new section components under `*.test.tsx`.
   - Add at least one E2E test that selects the template and asserts the
     consumer site renders without errors.
   - Keep coverage scoped to the foodcart modules per `pyproject.toml`.

6. **Security & performance**
   - Run `npm run test:a11y` and address violations.
   - Verify Core Web Vitals with the Web Vitals instrumentation.
   - Add CSP/hash/nonces if the template introduces inline scripts or styles.

7. **CI gate**
   - The change must pass `_ci-frontend.yml` (lint, typecheck, unit tests,
     a11y, build) and `_ci-e2e-real.yml` (onboard → preview → publish → view).

## 2. Adding a new admin dashboard feature

### Goal

Add a new page or capability to the admin dashboard (e.g. team management,
analytics, or a new content editor).

### Golden Path

1. **Auth & authorization**
   - Place new admin routes under `src/frontend/src/app/admin/dashboard/`.
   - Wrap pages with the existing `AdminProtectedRoute` or `DashboardShell`.
   - Backend routes must use `require_role("owner", "editor")` (or tighter
     roles) and resolve `tenant_id` from the authenticated user.

2. **Bounded context**
   - Decide which backend context owns the feature (Tenant, Site, Content, AI,
     Ingestion).
   - Add the router under the matching context in
     `src/backend/src/app/routers/foodcart/`.
   - Do not access another context's repositories directly; call its
     application service interface.

3. **API contract**
   - Add Pydantic request/response schemas in
     `src/backend/src/app/schemas_foodcart.py`.
   - Update `openapi.yaml` and regenerate frontend types if needed.
   - Add or update consumer contract tests in
     `src/frontend/src/__contracts__/foodcart.contract.test.ts`.

4. **Data & migrations**
   - Add Alembic migrations in `src/backend/alembic/versions/`.
   - Ensure every tenant-scoped table includes `tenant_id` and is filtered by
     it in repository queries.

5. **Feature flags**
   - Gate the feature behind an Unleash flag when rollout should be gradual.
   - Add the flag key to `ENABLED_FEATURES` defaults for local development.

6. **Tests**
   - Add backend tests in `src/backend/tests/foodcart/`.
   - Add frontend unit tests and at least one E2E smoke test.

7. **CI gate**
   - The change must pass `_ci-backend.yml`, `_ci-frontend.yml`,
     `contract-tests.yml`, and `_ci-e2e-real.yml`.

## 3. Adding a new AI Website Assistant operation

### Goal

Teach the AI assistant to handle a new natural-language request type (e.g.
"Translate my menu to Spanish" or "Reorder sections").

### Golden Path

1. **Allowlist review**
   - The AI assistant is a **stateless, schema-bound transformer**. It may only
     mutate fields inside the current site's `ContentBlock.data`.
   - Prohibited: account changes, billing, auth, site slug, custom domain, SQL,
     code execution, cross-tenant access.
   - Update the allowlist in `docs/adr/0003-ai-assistant-harness.md` and
     `src/backend/src/domain/services/foodcart.py`.

2. **Schema design**
   - Define the new patch operation shape in Pydantic (e.g. a new
     `PatchOperationSchema` variant or a new block-type field).
   - Validate the patch path against known block types and JSON Schema before
     application.

3. **Prompt engineering**
   - Update the system prompt in `src/backend/src/domain/services/foodcart.py`
     to describe the new operation with examples.
   - Keep the prompt hardening language that repeats prohibited operations.
   - Add adversarial tests in `src/backend/tests/foodcart/test_ai_guardrails.py`.

4. **Approval flow**
   - The change must go through `POST /sites/{id}/ai/propose` → UI diff → user
     approval → `POST /sites/{id}/ai/apply`.
   - Never apply changes in the `propose` handler.

5. **Revertibility**
   - Every applied change creates a `Revision` snapshot before mutation.
   - Verify `tests/foodcart/test_revisions.py` covers the new operation.

6. **Rate limits & quotas**
   - Confirm the operation fits within per-tenant daily propose/apply quotas.
   - Add telemetry (`ai_propose`, `ai_apply`) with prompt hash and model name.

7. **Safety validation**
   - Run `pytest tests/foodcart/test_ai_guardrails.py`.
   - Add a red-team test case for prompt-injection attempts targeting the new
     operation.

8. **CI gate**
   - The change must pass `_ci-backend.yml` (including SAST and scoped
     coverage), `security.yml`, and `_ci-e2e-real.yml`.

## Cross-cutting concerns

- All changes must pass the reusable CI workflows consumed by
  `.github/workflows/`.
- Coverage reporting is scoped to foodcart modules per `pyproject.toml`.
- Multi-tenant isolation must be enforced for any new tenant-scoped data.
- Custom infrastructure (DNS, CDN, object storage) is documented in
  `../pipeline/platform/terraform/` but provisioned separately.
- Platform feedback and requests should be filed with the `platform` label.
