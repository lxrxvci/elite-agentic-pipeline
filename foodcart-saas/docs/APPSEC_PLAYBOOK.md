# AppSec Playbook — Foodcart SaaS

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Author | AppSec Engineering |
| Date | 2026-06-24 |
| Status | Active |
| Champion ratio target | 1 AppSec : 5 Security Champions |

## Purpose

This playbook defines how AppSec Engineering enables the Foodcart SaaS squad to ship secure code at speed. It is a living companion to:

- `docs/THREAT_MODEL.md`
- `docs/SECURITY_REVIEW.md`
- `docs/SECURE_CODING_GUIDE.md`
- `pipeline/platform/security/`

## Security tooling matrix

| Layer | Tool | Scope | Frequency | Gate |
|---|---|---|---|---|
| SAST — Python | Bandit | `src/backend/src` | Every PR / push | Fail on medium+ |
| SAST — JS/TS | Semgrep | `src/frontend/src` | Every PR / push | Fail on high+ |
| SAST — CodeQL | GitHub CodeQL | Python + JS/TS | Every PR + weekly | Upload to GitHub Security tab |
| SCA — OS/libs | Trivy filesystem | Whole project | Every PR / push | Fail on CRITICAL/HIGH |
| SCA — Node | `npm audit` | `src/frontend` | Every PR / push | Fail on moderate+ |
| SCA — Python | `pip-audit` | `src/backend` | Every PR / push | Fail on CRITICAL/HIGH |
| SCA — PR diff | GitHub dependency-review | Changed dependencies | Every PR | Fail on high+ |
| Secrets | TruffleHog | Entire repo | Every PR / push | Fail on verified secrets |
| DAST | OWASP ZAP | Staging / production | Weekly + pre-release | Review findings before prod |
| Foodcart-specific | Custom pytest suite | Tenant isolation, AI guardrails, SSRF | Every PR / push | Zero failures |

## Foodcart-specific controls

### 1. Tenant isolation

Every tenant-scoped repository query must filter by `tenant_id`. The CI template `pipeline/platform/security/_foodcart-security-tests.yml` runs `tests/foodcart/test_tenant_isolation.py` on every PR.

**What to enforce:**
- No route handler trusts a client-provided `tenant_id`.
- Mutations return `404` when a resource belongs to another tenant (do not leak existence with `403`).
- New tables that hold tenant data must include a `tenant_id` column and foreign key.

### 2. AI assistant operation allowlist

The AI Website Assistant is strictly harnessed. It can only propose patches for known content blocks (hero, story, menu, locations/hours, catering, contact, order links, footer). It cannot delete accounts, change billing, modify Clerk/auth settings, execute code or SQL, change slugs/domains, or access other tenants.

**What to enforce:**
- Every LLM output path is validated against the allowlist (`validate_patch_path`).
- `POST /sites/{id}/ai/apply` requires `confirmed: true`.
- Red-team tests in `tests/foodcart/test_security.py` must stay current with new prohibited operations.

### 3. SSRF / URL validation

Ingestion fetches external URLs supplied by business owners. These URLs must be HTTP(S) only, must not resolve to private/link-local/localhost ranges, and every redirect target must be re-validated. Content block URL fields (`image_url`, `cta_url`, `map_url`, social/order links) must reject `javascript:`, `data:`, and `file:` schemes.

**What to enforce:**
- `validate_public_url` blocks private IPs and non-HTTP(S) schemes.
- Redirects are followed manually or via event hooks that re-validate each hop.
- DNS resolution failures fail closed (not open).

### 4. Secrets and logging

No secrets may be committed. Production secrets are centralized in AWS Secrets Manager (or equivalent). Structured logs redact `Authorization`, `Cookie`, `X-Api-Key`, tokens, and database URLs. `Revision.snapshot` and `IngestionJob.raw_payload` must not contain secrets or unredacted PII.

See `docs/SECRETS_MANAGEMENT.md` for the full secret inventory and rotation policy.

## Vulnerability SLA

| Severity | Discovery | Remediation target | Exception authority |
|---|---|---|---|
| Critical | SAST/SCA/DAST/red-team | 24 hours | AppSec Engineering + Tech Lead |
| High | SAST/SCA/DAST/red-team | 7 days | AppSec Engineering |
| Medium | SAST/SCA/DAST | 30 days | Security Champion |
| Low | SAST/SCA | 90 days | Security Champion |

SLA clocks start when a finding is first reported in an open issue or GitHub Security advisory. Critical findings may be temporarily mitigated by disabling a feature, revoking a secret, or adding a WAF rule until a code fix ships.

## CI/CD security gates

A PR cannot merge to `main` until:

1. Bandit, Semgrep, CodeQL, Trivy, `npm audit`, `pip-audit`, and TruffleHog pass.
2. Dependency-review passes for changed dependencies.
3. Foodcart-specific security regression tests pass.
4. No new CRITICAL/HIGH vulnerabilities are introduced.
5. Required status checks `ci`, `security`, and `contract-tests` succeed (see `infra/main.tf`).

## Roles and contacts

| Role | Responsibility | Escalation path |
|---|---|---|
| AppSec Engineering | Own platform templates, SLSA roadmap, vulnerability SLA, high-risk findings | #appsec |
| Security Champion (squad) | Squad-level threat modeling, scan triage, secure-code coaching | Escalate critical/high findings to AppSec |
| Backend Engineer | Implement authz, tenant isolation, AI guardrails, SSRF controls | Security Champion |
| Frontend Engineer | CSP, output encoding, secure URL rendering | Security Champion |
| DevOps/SRE | Secret store, IAM, network segmentation, incident containment | Security Champion → AppSec |

## Incident response

If a security incident is suspected:

1. **Contain** — rotate exposed secrets, revoke sessions, disable feature flags.
2. **Preserve** — retain logs, revision snapshots, and CI artifacts.
3. **Assess** — determine blast radius (tenant scope, data accessed).
4. **Notify** — Security Champion → AppSec Engineering → incident commander.
5. **Follow** — `docs/RUNBOOKS/incident-response.md`.

## References

- `docs/THREAT_MODEL.md`
- `docs/SECURITY_REVIEW.md`
- `docs/SECURE_CODING_GUIDE.md`
- `docs/SLSA_ROADMAP.md`
- `docs/SECRETS_MANAGEMENT.md`
- `pipeline/platform/security/`
