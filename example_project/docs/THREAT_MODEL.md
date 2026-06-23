# Threat Model

## Overview

| Attribute | Value |
|---|---|
| Product | Elite Freelancer SaaS Dashboard |
| Version | 0.1.0 |
| Author | Elite Agentic Squad |
| Date | 2026-06-22 |
| Status | Accepted |

## Scope

This threat model covers:
- The Vercel-hosted Next.js frontend (`src/frontend`).
- The Vercel-hosted FastAPI backend (`src/backend`).
- The PostgreSQL database (Neon/RDS) storing tenant data.
- GitHub Actions CI/CD pipelines and artifact flows.
- Authentication via Clerk OIDC/OAuth2.

Out of scope:
- Third-party payment processors (Stripe integration is future work).
- Clerk infrastructure itself (managed by Clerk).
- End-user device security.

## Data Flow Diagram

```
[User Browser] ──HTTPS──▶ [Vercel Edge / CDN] ──HTTPS──▶ [FastAPI Backend] ──TLS──▶ [PostgreSQL]
                               │                              │
                               ▼                              ▼
                         [Next.js Frontend]           [GitHub Actions / CI]
                               │
                               ▼
                    [Clerk OIDC / OAuth2]
```

## Threats

### T001 — Authentication Bypass via Dev-Only JWT Endpoint

| Field | Description |
|---|---|
| Threat ID | T001 |
| STRIDE category | Spoofing / Elevation of Privilege |
| Description | The `/auth/token` dev-only endpoint auto-provisions users. If accidentally enabled in production, attackers could mint valid tokens. |
| Likelihood | Low |
| Impact | Critical |
| Risk rating | High |
| Mitigation | Endpoint is disabled unless `ENV=development`. Production uses Clerk OIDC. Add CI test verifying endpoint returns 404 in production config. |
| Owner | Security / Backend |
| Status | Mitigated |

### T002 — Cross-Tenant Data Access

| Field | Description |
|---|---|
| Threat ID | T002 |
| STRIDE category | Information Disclosure / Elevation of Privilege |
| Description | A bug in repository queries could allow a user from one tenant to read or modify another tenant's clients, projects, time entries, or invoices. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Every repository query filters by `tenant_id`. Tenant-isolation tests run in CI. Add periodic audit query tests. |
| Owner | Backend |
| Status | Mitigated |

### T003 — Dependency Supply-Chain Attack

| Field | Description |
|---|---|
| Threat ID | T003 |
| STRIDE category | Tampering |
| Description | A compromised npm or PyPI package could introduce malicious code into the build. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | Dependabot alerts, `npm audit`, Trivy SCA, GitHub dependency review, lockfile-only installs in CI, TruffleHog secrets scanning. |
| Owner | Platform / Security |
| Status | Mitigated |

### T004 — Secrets Leakage in CI Logs or Repository

| Field | Description |
|---|---|
| Threat ID | T004 |
| STRIDE category | Information Disclosure |
| Description | Database URLs, API keys, or JWT secrets could be committed or printed in CI logs. |
| Likelihood | Medium |
| Impact | Critical |
| Risk rating | High |
| Mitigation | GitHub secrets, TruffleHog on PRs, `.env` in `.gitignore`, OIDC federation instead of long-lived tokens, no literal secrets in workflow files. |
| Owner | Platform / Security |
| Status | Mitigated |

### T005 — Injection Attacks (SQL, NoSQL, Command)

| Field | Description |
|---|---|
| Threat ID | T005 |
| STRIDE category | Tampering / Elevation of Privilege |
| Description | Unsanitized user input could lead to SQL injection or command execution. |
| Likelihood | Low |
| Impact | High |
| Risk rating | Medium |
| Mitigation | SQLAlchemy ORM with parameterized queries, Pydantic input validation, no shell interpolation in CI commands. |
| Owner | Backend |
| Status | Mitigated |

### T006 — Denial of Service via Auth or Mutation Endpoints

| Field | Description |
|---|---|
| Threat ID | T006 |
| STRIDE category | Denial of Service |
| Description | Attackers could brute-force login or abuse invoice/time-entry creation endpoints. |
| Likelihood | Medium |
| Impact | Medium |
| Risk rating | Medium |
| Mitigation | `slowapi` rate limiting on auth (expand to all mutation endpoints). Vercel DDoS protection. Add per-tenant rate limits. |
| Owner | Backend / SRE |
| Status | Partially Mitigated |

### T007 — Insecure Direct Object Reference (IDOR)

| Field | Description |
|---|---|
| Threat ID | T007 |
| STRIDE category | Information Disclosure / Elevation of Privilege |
| Description | Users could access resources by guessing UUIDs without authorization checks. |
| Likelihood | Medium |
| Impact | High |
| Risk rating | High |
| Mitigation | All resource endpoints verify tenant ownership. Add object-level authorization tests. |
| Owner | Backend |
| Status | Mitigated |

## Security Controls

| Control | Implementation | Verification |
|---|---|---|
| Authentication | Clerk OIDC/OAuth2 in production; dev JWT only in `development` | `test_clerk_auth.py`, CI config test |
| Authorization | Tenant-scoped queries; role claims from Clerk | `test_tenant_isolation.py`, `test_rbac.py` |
| Input validation | Pydantic v2 schemas | Unit tests, mypy strict |
| Output encoding | React escaping, CSP headers | E2E header checks |
| Rate limiting | `slowapi` on auth; expand to mutations | Integration tests |
| Logging & monitoring | Structured logs, OpenTelemetry, Grafana Cloud | Dashboard review, alerts |
| Dependency security | Dependabot, Trivy, npm audit, dependency review | CI security workflow |
| Secrets management | GitHub secrets, TruffleHog, OIDC | PR checks, audit logs |

## Action Items

| ID | Action | Owner | Due | Status |
|---|---|---|---|---|
| A001 | Expand rate limiting to all mutation endpoints | Backend | 2026-07-06 | Open |
| A002 | Add object-level authorization tests for all resources | Backend | 2026-07-06 | Open |
| A003 | Verify Clerk production auth integration in staging | Security | 2026-07-13 | Open |
| A004 | Complete DAST baseline scan with OWASP ZAP | Security | 2026-07-20 | Open |

## Review History

| Date | Reviewer | Notes |
|---|---|---|
| 2026-06-22 | Elite Agentic Squad | Initial threat model completed |
