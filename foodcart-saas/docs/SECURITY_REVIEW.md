# Security Review — Foodcart SaaS Cycle 1

## Initiative

| Field | Value |
|---|---|
| Initiative | Cycle 1 build: 10-Minute Publish Onboarding, Live Open/Closed + Hours, AI Assistant spike |
| Shaped bets | `docs/SHAPED_BETS.md` Bet 1, Bet 2, Bet 3 |
| ADRs | ADR 0001, ADR 0002, ADR 0003, ADR 0004 |
| Author | Security Champion |
| Date | 2026-06-24 |
| Status | Proposed |

## Summary

This review captures the security requirements, acceptance criteria, and verification plan for Cycle 1. It focuses on the highest-risk surfaces: authentication, authorization, tenant isolation, AI assistant guardrails, input validation, and secrets management. The review is aligned with OWASP ASVS Level 2 and STRIDE.

## Threat Summary

| Threat ID | Title | Risk | Mitigation owner |
|---|---|---|---|
| T001 | Cross-tenant data access | Critical | Backend Engineer |
| T002 | Authentication bypass / JWT tampering | Critical | Backend Engineer / DevOps |
| T004 | AI prompt injection → unauthorized mutations | High | Backend Engineer |
| T005 | AI assistant tenant data exfiltration | High | Backend Engineer |
| T006 | Malicious external link ingestion (SSRF) | High | Backend Engineer / DevOps |
| T008 | Stored/reflected XSS via content blocks | High | Frontend / Backend |
| T011 | Secrets leakage in logs/errors/snapshots | High | DevOps / Backend |
| T013 | Supply-chain / dependency compromise | Critical | Security Champion / DevOps |

## Requirements & Acceptance Criteria

### 1. Authentication

| ID | Requirement | Acceptance Criteria | Verification |
|---|---|---|---|
| AUTH-01 | Production must use Clerk JWT only. | `clerk_jwks_url` is required in production; dev-token path is disabled when `env != "development"`. | Unit test: dev-token rejected in production config. |
| AUTH-02 | JWTs must be validated completely. | `validate_clerk_token` checks signature (RS256), `exp`, `sub`, issuer, and audience; rejects expired/unsigned tokens. | Unit tests for valid, expired, bad-signature, missing-sub tokens. |
| AUTH-03 | Session cookies must be secure. | `elite_session` cookie uses `HttpOnly`, `Secure` in production, `SameSite=Lax` or `Strict`, and short expiry. | Inspect Set-Cookie headers; E2E. |
| AUTH-04 | MFA for privileged access (future; champion requirement). | Clerk organization owners can be required to enroll FIDO2/passkey before accessing billing/admin actions. | Deferred to billing cycle; track as backlog item. |

### 2. Authorization

| ID | Requirement | Acceptance Criteria | Verification |
|---|---|---|---|
| AUTHZ-01 | Role-based access control. | `owner` and `editor` roles are enforced; editors cannot delete sites or change tenant settings. | Integration tests for each role on each admin endpoint. |
| AUTHZ-02 | Roles are server-side authoritative. | Client cannot send or override `role`; role is derived from `User.role` in the database. | Attempted role override returns 400/403. |
| AUTHZ-03 | Resource ownership checks. | Mutations to content blocks, revisions, ingestion jobs, AI requests verify the resource belongs to the current tenant. | Cross-tenant mutation attempts return 404 (do not leak existence). |

### 3. Tenant Isolation

| ID | Requirement | Acceptance Criteria | Verification |
|---|---|---|---|
| TI-01 | Every tenant-scoped query is filtered. | Repository methods for Site, ContentBlock, Revision, AIRequest, IngestionJob include `tenant_id = :current_tenant_id`. | Code review + SQL query assertion tests. |
| TI-02 | Tenant context is injected centrally. | `get_current_user` / `get_current_tenant` dependencies provide `tenant_id`; route handlers do not trust client-provided tenant IDs. | Dependency injection review. |
| TI-03 | Cross-tenant reads are impossible. | A user from tenant A cannot list, view, or export data from tenant B via any API path. | Automated cross-tenant abuse tests in CI. |
| TI-04 | Slug reservation is atomic and unique. | Database unique constraint + atomic reserve prevents duplicate or race-condition slug creation. | Concurrency test for slug reservation. |

### 4. AI Assistant Guardrails

| ID | Requirement | Acceptance Criteria | Verification |
|---|---|---|---|
| AI-01 | Operation allowlist enforced. | LLM output can only produce patches for hero, story, menu, locations/hours, catering, contact, order_links, footer blocks. | Property tests + SPIKE-004. |
| AI-02 | Prohibited operations blocked. | Assistant cannot delete accounts, change billing, modify auth/Clerk settings, change slug/domain, execute code/SQL, or query other tenants. | Red-team prompt suite (SPIKE-005) ≥ 50 adversarial prompts, 0 unauthorized actions. |
| AI-03 | Explicit approval required. | `POST /sites/{id}/ai/apply` requires `confirmed: true`; a proposal cannot be applied in the same request that generated it. | E2E test of propose → apply flow; reject auto-apply. |
| AI-04 | Structured output validated. | All LLM responses parsed by Pydantic `ChangePreview` / `PatchOperation`; unknown fields and malformed JSON rejected. | Unit tests for malformed JSON, unknown ops, bad paths. |
| AI-05 | Patch path allowlist. | Each `path` must match a known block and field; values validated by block schema. | Unit tests for path traversal, out-of-block paths, invalid values. |
| AI-06 | Tenant scoping. | AI service receives only current tenant's `site_id` and content; prompt never references other tenants. | Code review + integration test. |
| AI-07 | Rate limits and circuit breaker. | Per-tenant daily limits (e.g., 100 proposes / 50 applies); 30s LLM timeout; circuit breaker at > 10% error rate over 5 min. | Load test + integration test. |
| AI-08 | Immutable revisions before apply. | Every applied AI change creates a `Revision` snapshot before mutation; revert succeeds. | Regression test: 100% revert success rate. |
| AI-09 | Audit logging. | Log prompt hash, model, response hash, user_id, applied patch, revision_id; retain 90 days. | Log inspection + retention policy check. |

### 5. Input Validation

| ID | Requirement | Acceptance Criteria | Verification |
|---|---|---|---|
| IV-01 | All API inputs validated by Pydantic. | Request bodies use Pydantic v2 schemas with strict types, enums, max lengths, and regex patterns. | OpenAPI spec diff review; fuzz tests. |
| IV-02 | Slug validation. | Slug matches `^[a-z0-9-]+$`, max 63 chars, no leading/trailing hyphen, normalized server-side. | Unit tests for invalid slugs. |
| IV-03 | URL validation. | All external URLs use `HttpUrl` / URI format; ingestion adapters reject non-HTTP(S) schemes. | Unit tests for `file://`, `javascript://`, etc. |
| IV-04 | SSRF prevention. | Ingestion workers block private/link-local ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `127.0.0.0/8`, `::1/128`, etc.) and localhost. | SSRF test suite. |
| IV-05 | Prompt length and content limits. | AI prompt max 2,000 chars; control characters stripped; no multi-megabyte payloads. | Unit tests. |
| IV-06 | File upload validation. | Logo/hero images validated by content type, extension, and max size; scanned for malware where feasible. | E2E upload tests. |
| IV-07 | Timezone validation. | `timezone` must be a valid IANA name (e.g., `America/Los_Angeles`). | Unit tests for invalid zones. |

### 6. Secrets Management

| ID | Requirement | Acceptance Criteria | Verification |
|---|---|---|---|
| SEC-01 | No secrets in code. | API keys, database passwords, Clerk secrets, LLM keys are never committed; pre-commit hook + TruffleHog. | CI secret scan passes. |
| SEC-02 | Production secrets centralized. | Use infisical / Doppler / AWS Secrets Manager; Terraform `sensitive = true`; application reads at startup. | Terraform plan review. |
| SEC-03 | Secret redaction in logs. | Structured log processor redacts `Authorization`, `Cookie`, API keys, and database URLs. | Log output inspection. |
| SEC-04 | No secrets in snapshots. | `Revision.snapshot` and `IngestionJob.raw_payload` do not contain API keys, tokens, or unredacted PII. | Data inspection + unit test. |
| SEC-05 | Development defaults blocked in production. | `Settings` rejects default `secret_key` placeholders when `env != "development"`. | Unit test. |

### 7. Additional Security Requirements

| ID | Requirement | Acceptance Criteria | Verification |
|---|---|---|---|
| ADD-01 | Security headers. | HSTS, CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on all responses. | Header inspection; CSP eval blocked. |
| ADD-02 | Rate limiting. | SlowAPI + per-tenant quotas return 429 on abuse; public endpoints have stricter limits. | Load test. |
| ADD-03 | CSRF protection. | `SameSite` cookies + Bearer auth for API; explicit confirmation for destructive actions. | E2E. |
| ADD-04 | Audit events. | `AIChangeProposed`, `AIChangeApplied`, `AIChangeRejected`, content mutations, publish/unpublish logged with actor and tenant. | Event log review. |
| ADD-05 | Dependency scanning. | Trivy, dependency-review, Bandit, Semgrep, CodeQL pass in CI; critical/high CVEs tracked to zero within SLA. | CI gates. |
| ADD-06 | Error messages leak no internals. | 500 responses return generic message; detailed trace only in logs. | E2E + code review. |

## Testing & Verification Plan

| Layer | Tool / Method | Scope | Owner |
|---|---|---|---|
| Unit | pytest | Clerk validation, Pydantic schemas, patch allowlist, SSRF checks | Backend Engineer |
| Integration | pytest + TestClient + test DB | Cross-tenant access, role checks, AI propose/apply, rate limits | Backend Engineer |
| Contract | Pact | API consumer/provider contracts with auth headers | SDET |
| E2E | Playwright | Onboarding flow, AI diff approval, publish/unpublish | Frontend Engineer |
| Security | Bandit, Semgrep, CodeQL, Trivy | SAST + SCA on every PR | Security Champion |
| Red team | Custom pytest suite | 50+ adversarial AI prompts (SPIKE-005) | Security Champion |
| DAST | OWASP ZAP (future) | Admin dashboard and public site | Security Champion |
| Secrets | TruffleHog + dependency-review | No leaked secrets or vulnerable deps | DevOps |

## Gating Criteria

Cycle 1 must not proceed to the design/build gate until:

1. All Critical and High threats from this review have a documented mitigation implemented or accepted by the Tech Lead and Security Champion.
2. Cross-tenant access regression tests pass in CI.
3. AI spike success criteria are met (SPIKE-004 > 90% schema conformance; SPIKE-005 0 unauthorized actions).
4. SCA scan shows zero critical/high vulnerabilities in direct dependencies, or a remediation plan with SLA.
5. Secret scanning (TruffleHog) passes.
6. Security headers and CSP are present on both admin and consumer responses.

## Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Tech Lead | | | |
| Security Champion | | | |
| Product Owner | | | |

## References

- `docs/THREAT_MODEL.md`
- `docs/adr/0003-ai-assistant-harness.md`
- `docs/SHAPED_BETS.md`
- `BACKLOG.md`
- `openapi.yaml`

---

# Cycle 1 Implementation Security Review

## Review Metadata

| Field | Value |
|---|---|
| Review type | Implementation verification (Design & Build workflow, Step 5) |
| Reviewer | Security Champion |
| Date | 2026-06-24 |
| Scope | `src/backend/src`, `src/frontend/src`, `openapi.yaml`, dependency manifests |
| Status | Open findings — see remediation tracker below |

## Executive Summary

Cycle 1 delivers the core Foodcart SaaS feature set with a strong secure-by-default posture. Tenant isolation, Clerk JWT integration, AI approval gating, revision immutability, SSRF controls, and security headers are all implemented. The codebase passes `npm audit` and `bandit` with zero findings.

Three gaps require action before the design/build gate:

1. **URL-based XSS risk** — content block schemas accept plain strings for URLs, allowing `javascript:` and `data:` schemes in `cta_url`, `image_url`, and social/order links. React escapes text but not URL schemes in `href`/`src`.
2. **SSRF redirect bypass** — ingestion validates the initial hostname but does not re-validate URLs after HTTP redirects, and `socket.gethostbyname` can fail open for unresolvable hostnames.
3. **Missing security-audit events** — cross-tenant access attempts, SSRF blocks, and AI operation refusals are not emitted as structured security events.

These are tracked as **REM-001**, **REM-002**, and **REM-003** below.

## Verified Controls

| Control | Status | Evidence |
|---|---|---|
| **Tenant isolation** | ✅ Implemented | Every Foodcart repository (`SiteRepository`, `ContentBlockRepository`, `RevisionRepository`, `IngestionJobRepository`, `AIRequestRepository`) filters by `tenant_id`. Routes use `_ensure_site_owned` before serving or mutating resources. |
| **Clerk JWT validation** | ✅ Implemented | `validate_clerk_token` verifies RS256 signature, `exp`, `sub`, issuer, audience; `Settings.require_clerk_in_production` blocks production startup without `CLERK_JWKS_URL`. |
| **Dev-token gating** | ✅ Implemented | `_get_user_from_dev_token` is only reachable when `settings.env == "development"` and `settings.clerk_jwks_url` is unset. |
| **Role-based access** | ✅ Implemented | `require_role("owner")` / `require_role("owner", "editor")` used on onboarding, site mutation, content, AI, ingestion, and revision endpoints. |
| **AI operation allowlist** | ✅ Implemented | `generate_change_preview` is a deterministic schema-bound transformer; `apply_patch_operations` validates every path against `validate_patch_path`; `POST /sites/{id}/ai/apply` requires `confirmed: true`. |
| **AI revision snapshots** | ✅ Implemented | Every AI apply creates a `Revision` snapshot of the full content before mutation; revert re-creates blocks from the snapshot. |
| **Prompt injection keyword guard** | ✅ Implemented | `_is_prompt_in_scope` rejects prompts containing prohibited keywords (billing, auth, clerk, slug, domain, execute, sql, "ignore previous instructions", etc.) up to the 2,000-char limit. |
| **SSRF input validation** | ✅ Implemented | `validate_public_url` enforces HTTP(S) only and blocks private/internal hosts via `_is_private_host`. |
| **HTML/text output escaping** | ⚠️ Partial | React escapes text content by default; no `dangerouslySetInnerHTML` observed. However, URL attributes are not scheme-validated, creating a URL-XSS vector. |
| **Security headers** | ✅ Implemented | Backend middleware sets `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, CSP, and HSTS (non-dev). |
| **Preview tokens** | ✅ Implemented | `sign_preview_token` / `verify_preview_token` produce short-lived (15 min default) HMAC-SHA256 tokens bound to `site_id`. |
| **Secrets in config** | ✅ Implemented | `Settings` loads from environment, rejects default placeholders in production, and does not log secrets. |

## Gap Analysis & Remediation Tracker

| ID | Threat | Finding | Risk | Remediation | Owner | SLA |
|---|---|---|---|---|---|---|
| REM-001 | T008 — Stored/reflected XSS | `HeroBlockData.image_url`, `HeroBlockData.cta_url`, `OrderLink.url`, `LocationData.map_url`, and social link URLs are typed as `str` rather than `HttpUrl`, allowing `javascript:` and other dangerous schemes. React text escaping does not protect URL attributes. | High | Add `HttpUrl` / scheme allowlist validation to block data/javascript/file schemes in block data schemas; add frontend tests proving `javascript:` URLs are not rendered as executable links. | Backend + Frontend Engineer | Cycle 1 week 4 |
| REM-002 | T006 — SSRF via redirects | `_fetch_url` calls `validate_public_url` once, then follows redirects with `httpx.Client(follow_redirects=True)`. A public host that redirects to `169.254.169.254` or `localhost` can bypass the guard. `_is_private_host` also returns `False` when DNS resolution fails, allowing unresolvable hostnames through. | High | Re-validate each redirect target with `validate_public_url` using an `event_hook`; reject unresolvable hostnames instead of allowing them; cap redirects. | Backend Engineer | Cycle 1 week 4 |
| REM-003 | T001/T004/T006 — Audit coverage | Cross-tenant access attempts, SSRF blocks, and AI out-of-scope refusals are not emitted as structured security events. This limits incident response and detection. | Medium | Add security audit logs: `security.cross_tenant_attempt`, `security.ssrf_blocked`, `security.ai_refused` with tenant/user/context. | Backend Engineer | Cycle 1 week 4 |
| REM-004 | T012 — Preview token secret reuse | Preview tokens are signed with `settings.secret_key`, the same key used for legacy dev JWTs. A dedicated preview-secret rotation policy would reduce blast radius. | Low | Introduce `PREVIEW_TOKEN_SECRET` setting; fall back to `SECRET_KEY` only for backward compatibility during Cycle 1. | Backend Engineer | Cycle 2 |
| REM-005 | T011 — Secrets in ingestion snapshots | `IngestionJob.raw_payload` stores the fetched HTML/text. While no API keys are added, ingestion responses could contain PII or session cookies from the target site if passed in the URL or headers. | Low | Add a sanitizer that strips `Set-Cookie`, `Authorization`, and other sensitive headers from `raw_payload`; document retention policy. | Backend Engineer | Cycle 2 |

## Dependency Scan Findings

### Python SAST — Bandit

| Tool | Scope | Findings | Severity | SLA |
|---|---|---|---|---|
| Bandit 1.9.4 | `src/backend/src` | 0 issues | — | — |

**Details:** The previously reported B110 try-except-pass in `app/observability.py:205` was resolved by logging the exception in `shutdown_tracing()` instead of silently passing. Bandit now reports zero findings.

### Node SCA — npm audit

| Tool | Scope | Findings | Severity | SLA |
|---|---|---|---|---|
| npm audit | `src/frontend/package.json` + `package-lock.json` | 0 vulnerabilities | — | — |

`npm audit --audit-level=moderate` returned **0 vulnerabilities**. No action required.

### Python SCA

`pip-audit` was not run in this review. The CI workflow should add `pip-audit` or `trivy filesystem` for Python dependency scanning to satisfy the SCA gate.

## Test Coverage Added / Verified

| Test file | Coverage |
|---|---|
| `tests/foodcart/test_tenant_isolation.py` | Cross-tenant reads/mutations on sites, content, AI, revisions return 404. |
| `tests/foodcart/test_ai.py` | Propose/apply flow, confirmation gate, billing keyword refusal, revision creation, re-apply prevention. |
| `tests/foodcart/test_ingestion.py` | SSRF block for `localhost`, job lifecycle. |
| `tests/foodcart/test_security.py` *(new)* | Prompt-injection refusals, SSRF redirect/DNS edge cases, block URL scheme validation, cross-tenant ingestion/revision/AI abuse. |
| `src/frontend/src/features/public-site/ui/PublicSitePage.test.tsx` *(updated)* | Verifies React escapes HTML text and does not execute `javascript:` URLs. |

## Gating Recommendation

Cycle 1 may proceed to the design/build gate **conditionally** once:

1. REM-001, REM-002, and REM-003 are implemented or accepted in writing by the Tech Lead and Security Champion.
2. Cross-tenant and AI red-team tests pass in CI.
3. `npm audit` and the planned Python SCA scan remain at zero critical/high findings.

REM-004 and REM-005 are accepted risks for Cycle 2 and should be added to the backlog before public beta.

## Sign-off

| Role | Name | Decision | Date |
|---|---|---|---|
| Tech Lead | | | |
| Security Champion | | | |
