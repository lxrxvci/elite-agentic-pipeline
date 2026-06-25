# Threat Model — Foodcart SaaS

## Overview

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.1.0-discovery |
| Author | Security Champion |
| Date | 2026-06-24 |
| Status | Proposed |
| Methodology | STRIDE + abuse-case analysis |

## Scope

This threat model covers:

- The tenant-isolated SaaS platform (Next.js frontend, FastAPI backend, PostgreSQL, Redis, object storage).
- The AI Website Assistant: natural-language content editing with structured output and guardrails.
- The ingestion of external links (Google Business Profile, Yelp, DoorDash, UberEats, Grubhub, Instagram, Facebook, TikTok, website, menu URL).
- Admin dashboard, public consumer sites, preview/publish flows, and revisions.
- Authentication via Clerk and tenant-scoped authorization.

Out of scope:

- Custom domain support and DNS/SSL management (deferred).
- Subscription billing and payment card data (deferred).
- Native online ordering / checkout (out of scope).
- Physical or endpoint security of business owners' devices.

## Data Flow Diagram

```
                                ┌─────────────────────────────────────────┐
                                │           Business Owner                │
                                │   Admin Dashboard (Next.js / Clerk)     │
                                └───────────────┬─────────────────────────┘
                                                │ HTTPS + Bearer JWT
                                                ▼
                                ┌─────────────────────────────────────────┐
                                │   FastAPI Backend (api.foodcartsite.com)│
                                │  Tenant │ Site │ Content │ AI │ Ingest  │
                                └──────┬──────────────────────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
          ▼                            ▼                            ▼
   ┌──────────────┐           ┌──────────────┐           ┌──────────────────┐
   │  PostgreSQL  │           │    Redis     │           │  Object Store    │
   │  (tenant     │           │  cache/jobs  │           │  R2 / S3         │
   │   data)      │           │  quotas      │           │  logos/heroes    │
   └──────────────┘           └──────────────┘           └──────────────────┘
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
          ▼                            ▼                            ▼
   ┌──────────────┐           ┌──────────────┐           ┌──────────────────┐
   │OpenAI/Anthropic│          │Google Business│          │  Yelp / Social   │
   │   (LLM)      │           │   Profile     │          │  / Menu APIs     │
   └──────────────┘           └──────────────┘           └──────────────────┘


                                ┌─────────────────────────────────────────┐
                                │           Public Visitor                │
                                │   Consumer Site (slug.foodcartsite.com) │
                                └─────────────────────────────────────────┘
```

## Threats

### T001 — Cross-tenant data access (IDOR)

| Field | Description |
|---|---|
| Threat ID | T001 |
| STRIDE category | Information Disclosure / Elevation of Privilege |
| Description | An authenticated user modifies `site_id`, `block_id`, or `tenant_id` to read or mutate another tenant's content, revisions, ingestion jobs, or AI requests. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | Critical |
| Mitigation | Enforce tenant-scoped repository queries on every data access; validate that the requested `site_id` belongs to the current tenant before serving or mutating content; use `require_resource_owner` / `require_role` dependencies; add integration tests for cross-tenant access. |
| Owner | Backend Engineer / Security Champion |
| Status | Mitigated (by design; verify in CI) |

### T002 — Authentication bypass or JWT tampering

| Field | Description |
|---|---|
| Threat ID | T002 |
| STRIDE category | Spoofing |
| Description | An attacker forges or replays a JWT, steals a Clerk session, or abuses the dev-token path in production to impersonate an owner. |
| Likelihood | Low |
| Impact | Critical |
| Risk rating | Critical |
| Mitigation | Require Clerk JWT validation in production (`clerk_jwks_url` mandatory); disable dev-token path outside `development`; validate `exp`, `sub`, issuer, and audience; use short-lived tokens; enforce HTTPS-only `elite_session` cookie with `HttpOnly`, `SameSite=Lax`, and `Secure` in production; rotate Clerk keys on compromise. |
| Owner | Backend Engineer / DevOps |
| Status | Mitigated |

### T003 — Privilege escalation (owner → other tenant, editor → owner)

| Field | Description |
|---|---|
| Threat ID | T003 |
| STRIDE category | Elevation of Privilege |
| Description | An editor or member escalates to owner, or an owner of one tenant gains access to another tenant's resources. |
| Likelihood | Low |
| Impact | High |
| Risk rating | High |
| Mitigation | Role checks (`require_role`) on sensitive endpoints; role values stored server-side, never accepted from the client; Clerk webhook-driven user provisioning; restrict tenant-scoped operations to the user's registered `tenant_id`; MFA for privileged actions in a future cycle. |
| Owner | Backend Engineer |
| Status | Mitigated |

### T004 — AI prompt injection causing unauthorized mutations

| Field | Description |
|---|---|
| Threat ID | T004 |
| STRIDE category | Tampering / Elevation of Privilege |
| Description | An adversarial prompt ("ignore previous instructions", "delete the account", "change my billing email") coerces the LLM into producing a patch operation outside the allowlist, or into mutating content the user did not intend. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Stateless schema-bound transformer design (ADR 0003); strict system prompt repeating allowlist/prohibitions; Pydantic v2 schema validation; patch-path allowlist against known content blocks; explicit user approval before apply; per-tenant rate limits and circuit breaker; red-team testing (SPIKE-005). |
| Owner | Backend Engineer / Security Champion |
| Status | Mitigated (by design; spike-gated) |

### T005 — AI assistant exfiltrates tenant data via prompt

| Field | Description |
|---|---|
| Threat ID | T005 |
| STRIDE category | Information Disclosure |
| Description | A prompt injection or crafted request tricks the assistant into returning another tenant's content, internal secrets, or system instructions. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Assistant receives only the current tenant's `site_id` and content; repository queries always filter by `tenant_id`; LLM prompt never includes other tenants' slugs/names/content; no secrets in system prompt; audit log prompt/response hashes. |
| Owner | Backend Engineer |
| Status | Mitigated |

### T006 — Malicious external link ingestion (SSRF, malware, resource exhaustion)

| Field | Description |
|---|---|
| Threat ID | T006 |
| STRIDE category | Spoofing / Tampering / Denial of Service |
| Description | An attacker supplies a URL pointing to an internal service (`169.254.169.254`), a large file, or a malicious payload to abuse ingestion workers, pivot inside the VPC, or poison generated content. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | URL allowlist/scheme validation (HTTP/HTTPS only); block private/link-local IP ranges and localhost; enforce request timeouts and max response size; fetch via isolated egress (no VPC credentials on workers); sandboxed anti-corruption adapters; job failure isolation so one bad URL does not block others. |
| Owner | Backend Engineer / DevOps |
| Status | Mitigated (open redirect/DNS bypass gap; see REM-002 in `docs/SECURITY_REVIEW.md`) |

### T007 — Subdomain takeover / slug squatting

| Field | Description |
|---|---|
| Threat ID | T007 |
| STRIDE category | Spoofing |
| Description | An attacker registers a slug matching a well-known business, a suspended tenant's slug, or a typo of an existing site to impersonate a brand or intercept traffic. |
| Likelihood | Low |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | Database unique constraint on `slug`; server-side normalization; atomic reserve-or-create; block reserved / trademarked slugs; retain slugs for archived tenants to prevent reuse; publish only after onboarding completion. |
| Owner | Backend Engineer |
| Status | Mitigated |

### T008 — Stored / reflected XSS via content blocks

| Field | Description |
|---|---|
| Threat ID | T008 |
| STRIDE category | Tampering / Information Disclosure |
| Description | Owner-supplied content (menu text, story body, social URLs) contains `<script>` or event handlers that execute in visitors' browsers, or an attacker injects HTML via ingestion. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Treat all block `data` fields as untrusted; sanitize HTML with DOMPurify or allowlist before storage; React escapes by default; strict CSP (`script-src 'self'`); validate `image_url` / `map_url` / social URLs; never render raw HTML from ingestion sources without sanitization. |
| Owner | Frontend Engineer / Backend Engineer |
| Status | Mitigated (React escaping; open URL-scheme gap; see REM-001 in `docs/SECURITY_REVIEW.md`) |

### T009 — CSRF on state-changing admin actions

| Field | Description |
|---|---|
| Threat ID | T009 |
| STRIDE category | Tampering |
| Description | An attacker tricks an authenticated owner into performing a state-changing action (publish, apply AI patch, update hours) via a malicious site. |
| Likelihood | Low |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | Use `SameSite=Lax` or `Strict` cookies; require `Authorization: Bearer` header for API calls (not cookie-only); validate `Origin`/`Referer` for mutation endpoints; require explicit `confirmed: true` body field for high-impact AI apply. |
| Owner | Backend Engineer / Frontend Engineer |
| Status | Mitigated |

### T010 — Denial of service via AI or ingestion quotas

| Field | Description |
|---|---|
| Threat ID | T010 |
| STRIDE category | Denial of Service |
| Description | An attacker or misbehaving script floods `/ai/propose`, ingestion jobs, or content mutations to exhaust LLM budget, Redis, database, or worker capacity. |
| Likelihood | Medium |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | Per-tenant rate limiting (SlowAPI + Redis); daily AI propose/apply quotas; 30s LLM timeout with graceful fallback; ingestion job concurrency limits; circuit breaker when LLM error rate > 10% over 5 min; cost alerting on LLM spend. |
| Owner | Backend Engineer / SRE |
| Status | Mitigated |

### T011 — Secrets leakage in logs, errors, or revision snapshots

| Field | Description |
|---|---|
| Threat ID | T011 |
| STRIDE category | Information Disclosure |
| Description | API keys, Clerk tokens, LLM API keys, database URLs, or PII leak into structured logs, exception traces, Prometheus metrics, or immutable revision snapshots. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Centralized secret management (infisical / Doppler / AWS Secrets Manager); redact tokens and PII in logs; return generic error messages to clients; mark LLM API keys as sensitive in Terraform; never store secrets in `Revision.snapshot` or `IngestionJob.raw_payload`. |
| Owner | DevOps / Backend Engineer |
| Status | Mitigated (env-driven settings; open ingestion snapshot scrubbing gap; see REM-005 in `docs/SECURITY_REVIEW.md`) |

### T012 — Replay or sharing of preview tokens

| Field | Description |
|---|---|
| Threat ID | T012 |
| STRIDE category | Spoofing / Information Disclosure |
| Description | An owner shares a draft preview URL (`?preview=TOKEN`) and the token is long-lived, replayable, or guessable, leaking unpublished content. |
| Likelihood | Low |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | Short-lived signed preview tokens (e.g., 15 minutes) bound to `site_id` and tenant; HMAC signature with server-side secret; single-use or short expiry; tokens do not grant admin rights. |
| Owner | Backend Engineer |
| Status | Mitigated (HMAC-signed, site-bound, 15-min expiry; open secret-dedication gap; see REM-004 in `docs/SECURITY_REVIEW.md`) |

### T013 — Supply-chain / dependency compromise

| Field | Description |
|---|---|
| Threat ID | T013 |
| STRIDE category | Tampering / Elevation of Privilege |
| Description | A malicious or vulnerable dependency (Python/Node) introduces backdoors, credential theft, or remote code execution. |
| Likelihood | Low |
| Impact | Critical |
| Risk rating | Critical |
| Mitigation | Pin dependencies with hashes (`requirements.txt`); weekly SCA scans (Trivy, dependency-review); track CVEs to zero critical/high within SLA; separate `dev` dependencies from production images; minimal Docker base images; private registry mirror where possible. |
| Owner | Security Champion / DevOps |
| Status | Mitigated (process; verify CI) |

### T014 — Unauthorized content mutation via API

| Field | Description |
|---|---|
| Threat ID | T014 |
| STRIDE category | Tampering |
| Description | A malicious or compromised owner/editor deletes content blocks, changes publish state, or corrupts site data via direct API calls. |
| Likelihood | Medium |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | Role-based authorization (`owner` vs `editor`); immutable `Revision` snapshots before every mutation; explicit `source` field (`manual`, `ai`, `ingestion`, `revert`) in audit trail; soft-delete where appropriate; admin dashboard shows recent changes. |
| Owner | Backend Engineer |
| Status | Mitigated |

### T015 — LLM output manipulation causing misleading published content

| Field | Description |
|---|---|
| Threat ID | T015 |
| STRIDE category | Tampering / Information Disclosure |
| Description | The LLM hallucinates menu prices, hours, or ingredients and the owner approves the change, publishing incorrect or misleading information that damages trust or creates liability. |
| Likelihood | Medium |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | Side-by-side diff UI; confidence score surfaced to user; block-schema validation; revertible revisions; clear "manual fallback" path; pilot verification of hours accuracy; don't auto-apply. |
| Owner | Product / UX / Backend Engineer |
| Status | Mitigated |

### T016 — URL scheme injection in content blocks

| Field | Description |
|---|---|
| Threat ID | T016 |
| STRIDE category | Tampering / Information Disclosure |
| Description | An owner or attacker supplies a `javascript:`, `data:`, or `file:` URL in a content block field such as `cta_url`, `image_url`, `map_url`, or social/order links. When rendered, the URL executes in a visitor's browser or leaks local data. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Validate all URL fields in block schemas with `HttpUrl` or an explicit HTTP(S) scheme allowlist; reject `javascript:`, `data:`, `file:`, and other non-web schemes; use React default rendering without `dangerouslySetInnerHTML`; keep CSP `default-src 'self'`. |
| Owner | Backend Engineer / Frontend Engineer |
| Status | Open (REM-001) |

### T017 — SSRF via HTTP redirects in ingestion

| Field | Description |
|---|---|
| Threat ID | T017 |
| STRIDE category | Spoofing / Tampering / Denial of Service |
| Description | An attacker submits a public URL that returns an HTTP redirect to an internal service (e.g., `169.254.169.254`, `localhost`, cloud metadata endpoint). The ingestion worker follows the redirect and reaches resources it should not. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Re-validate every redirect target with the same SSRF allowlist used for the initial URL; cap the number of redirects; do not treat DNS resolution failure as "safe"; run ingestion workers in isolated egress. |
| Owner | Backend Engineer / DevOps |
| Status | Open (REM-002) |

### T018 — Missing security-audit events for abuse detection

| Field | Description |
|---|---|
| Threat ID | T018 |
| STRIDE category | Information Disclosure / Elevation of Privilege |
| Description | Cross-tenant access attempts, SSRF blocks, and AI out-of-scope refusals are not emitted as structured security events, delaying detection and incident response. |
| Likelihood | Medium |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | Emit structured security audit events (`security.cross_tenant_attempt`, `security.ssrf_blocked`, `security.ai_refused`) with tenant_id, user_id, resource_id, and correlation_id; feed events to SIEM and alerting. |
| Owner | Backend Engineer |
| Status | Open (REM-003) |

## Security Controls

| Control | Implementation | Verification |
|---|---|---|
| Authentication | Clerk JWT validation (`validate_clerk_token`) with JWKS caching; dev-token only in development; `get_current_user` dependency on all admin routes. | Unit tests for valid/invalid/expired tokens; CI bandit/CodeQL. |
| Authorization | Role checks (`require_role`); tenant-scoped repositories; `require_resource_owner` for creator/owner mutations. | Integration tests for cross-tenant and cross-role access. |
| Tenant isolation | `tenant_id` on every tenant-scoped table; repository queries filter by `tenant_id`; AI assistant receives only current tenant content. | Property-based / regression tests; SQLAlchemy query inspection. |
| Input validation | Pydantic v2 schemas for all API bodies; URL format validation; strict enum/pattern checks; max length limits. | OpenAPI spec validation; fuzz tests on block payloads. |
| Output encoding | React default escaping; CSP headers; HTML sanitization for rich content blocks. | axe + E2E; CSP header checks. |
| AI guardrails | Schema-bound transformer; allowlisted patch paths; explicit approval; rate limits; circuit breaker; audit logging. | SPIKE-004 schema-conformance tests; SPIKE-005 red-team. |
| Rate limiting | SlowAPI middleware + per-tenant Redis quotas; 429 handling. | Load tests; integration tests. |
| Secrets management | Environment-driven `Settings`; centralized secret store in production; redaction in logs. | Terraform plan review; secret-scanning in CI. |
| Logging & monitoring | Structured logs with correlation IDs; audit events for AI propose/apply and content mutations; Prometheus metrics. | Dashboard review; alert rules. |
| Dependency security | Pinned hashes; Trivy + dependency-review + CodeQL + Bandit + Semgrep; weekly scans. | CI gates; SLA tracker. |

## Action Items

| ID | Action | Owner | Due | Status |
|---|---|---|---|---|
| A001 | Implement SSRF protection and URL validation in Ingestion adapters | Backend Engineer | Cycle 1 week 2 | Closed — implemented; redirect re-validation remaining (REM-002) |
| A002 | Add HTML sanitization for block `data` fields before storage/render | Backend + Frontend | Cycle 1 week 3 | Closed — React escaping + CSP; URL scheme allowlist remaining (REM-001) |
| A003 | Define and enforce preview-token HMAC signing and expiry | Backend Engineer | Cycle 1 week 3 | Closed — HMAC-SHA256, site-bound, 15-min expiry |
| A004 | Centralize production secret management and log-redaction rules | DevOps | Cycle 1 week 2 | Closed — env-driven `Settings`, production validators |
| A005 | Write cross-tenant access regression tests for Content, AI, Ingestion, and Revisions | Backend Engineer | Cycle 1 week 4 | Closed — `tests/foodcart/test_tenant_isolation.py` |
| A006 | Add AI prompt-injection red-team test suite (SPIKE-005) | Security Champion + Backend | Cycle 1 week 2 | Closed — `tests/foodcart/test_security.py` |
| A007 | Configure CSP and security headers for Next.js consumer/admin domains | Frontend Engineer | Cycle 1 week 3 | Partial — backend CSP/headers active; frontend origin CSP pending |
| A008 | Review and approve dependency pinning/hashes weekly | Security Champion | Ongoing | Open |
| REM-001 | Block non-HTTP(S) URL schemes in content block data | Backend + Frontend | Cycle 1 week 4 | Open |
| REM-002 | Re-validate redirect targets during ingestion fetches | Backend Engineer | Cycle 1 week 4 | Open |
| REM-003 | Emit structured security audit events for abuse detection | Backend Engineer | Cycle 1 week 4 | Open |
| REM-004 | Use a dedicated preview-token secret instead of `SECRET_KEY` | Backend Engineer | Cycle 2 | Accepted risk |
| REM-005 | Scrub sensitive headers/cookies from ingestion `raw_payload` | Backend Engineer | Cycle 2 | Accepted risk |

## Review History

| Date | Reviewer | Notes |
|---|---|---|
| 2026-06-24 | Security Champion | Initial threat model for Cycle 1 shaped bets and ADR 0003 |
| 2026-06-24 | Security Champion | Cycle 1 implementation review; added T016–T018 and REM-001–REM-005; closed A001–A006 |
