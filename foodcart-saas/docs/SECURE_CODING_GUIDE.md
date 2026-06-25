# Secure Coding Guide — Foodcart SaaS

## Purpose

This guide gives the squad concrete, secure-by-default patterns for the Foodcart SaaS stack. It is a living document: update it when we add new contexts, dependencies, or attack surfaces.

## Scope

- Frontend: Next.js 15+ App Router, React 19, TypeScript, Tailwind CSS
- Backend: FastAPI, Python 3.12+, Pydantic v2, SQLAlchemy 2, PostgreSQL 16
- Auth: Clerk (production), dev JWT (local only)
- Infrastructure: Docker, Vercel, Terraform, Redis, R2/S3

## 1. Authentication Patterns

### Always use `get_current_user`

```python
from fastapi import Depends
from app.dependencies import get_current_user, CurrentUser

@app.get("/api/v1/sites/{site_id}")
def get_site(site_id: UUID, user: CurrentUser = Depends(get_current_user)):
    ...
```

- Do **not** parse the JWT manually in route handlers.
- Do **not** trust a `tenant_id` sent by the client.
- The `user` object is the only source of identity and tenant membership.

### Clerk-only in production

- `clerk_jwks_url` is mandatory in production (`Settings.require_clerk_in_production`).
- The dev-token path (`_get_user_from_dev_token`) is gated to `env == "development"`.
- If you add a new auth bypass for local testing, file a ticket and add a production-blocking test.

### Cookie security

- `elite_session` must be:
  - `HttpOnly`
  - `Secure` in production
  - `SameSite=Lax` minimum (`Strict` for admin-only cookies)
  - short-lived (refresh via Clerk session)

## 2. Authorization Patterns

### Enforce roles with `require_role`

```python
from app.dependencies import require_role

owner_only = require_role("owner")

@app.delete("/api/v1/sites/{site_id}")
def delete_site(user: CurrentUser = Depends(owner_only)):
    ...
```

### Resource ownership before mutation

```python
from app.dependencies import require_resource_owner
from infrastructure.repositories import ContentRepository

def get_block_or_none(repo: ContentRepository, block_id: UUID) -> ContentBlock | None:
    return repo.get_block(block_id)

owner_or_creator = require_resource_owner(ContentRepository, get_block_or_none)
```

- Return `404` when a resource does not belong to the tenant. Do **not** return `403`—it leaks existence.

## 3. Tenant Isolation Patterns

### Every repository query filters by `tenant_id`

```python
class ContentRepository:
    def __init__(self, db: Session, tenant_id: UUID) -> None:
        self.db = db
        self.tenant_id = tenant_id

    def list_blocks(self, site_id: UUID) -> list[ContentBlock]:
        return (
            self.db.query(ContentBlock)
            .filter_by(site_id=site_id, tenant_id=self.tenant_id)
            .order_by(ContentBlock.sort_order)
            .all()
        )
```

### Never pass a tenant boundary

- AI prompts include only the current tenant's content.
- Ingestion jobs are keyed to `(tenant_id, site_id)`.
- Background workers must look up the tenant from the job record, not from the payload.

## 4. Input Validation Patterns

### Prefer strict Pydantic v2 schemas

```python
from pydantic import BaseModel, Field, HttpUrl

class MenuItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: str | None = Field(None, max_length=500)
    price: str = Field(..., pattern=r"^\$?\d+(\.\d{2})?$")
    image_url: HttpUrl | None = None
```

- Use `Field(..., pattern=...)` for slugs, prices, phone numbers.
- Use `HttpUrl` for all external URLs.
- Reject unknown fields (`model_config = ConfigDict(extra="forbid")`) where appropriate.

### Slug validation

```python
import re

SLUG_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
```

- Server-side normalization (lowercase, strip whitespace, collapse dashes).
- Block reserved slugs and trademarks.

### URL / SSRF prevention in ingestion

```python
from urllib.parse import urlparse
import ipaddress

ALLOWED_SCHEMES = {"http", "https"}
BLOCKED_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    # Add link-local / unique-local IPv6 as needed
]

def is_safe_url(url: str) -> bool:
    parsed = urlparse(url)
    if parsed.scheme not in ALLOWED_SCHEMES:
        return False
    try:
        host = parsed.hostname
        if not host:
            return False
        addr = ipaddress.ip_address(host)
        return not any(addr in net for net in BLOCKED_NETWORKS)
    except ValueError:
        # hostname is not an IP; safe to resolve later with DNS controls
        return True
```

- Always set request timeouts (≤ 10s) and max response size (≤ 5 MB).
- **Re-validate every redirect target** with the same allowlist; do not trust the initial hostname after an HTTP 3xx.
- Do not treat DNS resolution failure as "safe"; fail closed when a hostname cannot be resolved.
- Run ingestion workers without VPC credentials or IMDS access.

#### Anti-pattern observed in Cycle 1

`httpx.Client(follow_redirects=True)` was used after a single `validate_public_url()` call. A public host that redirects to `http://169.254.169.254/latest/meta-data/` would bypass the guard. Fix: use `event_hooks={"request": [_validate_redirect_target]}` or disable redirects and handle them manually.

## 5. Output Encoding / XSS Prevention

### Treat all content block data as untrusted

- React escapes by default; do **not** use `dangerouslySetInnerHTML`.
- If rich text is needed later, sanitize with DOMPurify server-side before storage.
- **Validate URL schemes in block data fields.** Use `pydantic.HttpUrl` or an explicit allowlist so `cta_url`, `image_url`, `map_url`, and social/order links cannot carry `javascript:`, `data:`, or `file:` schemes.
- Canonicalize URLs before rendering; never pass unsanitized strings directly to `href` or `src`.

#### Anti-pattern observed in Cycle 1

`HeroBlockData`, `OrderLink`, and `LocationData` used `str` for URL fields. A malicious `cta_url` of `javascript:alert(document.cookie)` would be rendered as a clickable link. Fix: model URL fields as `HttpUrl` or validate schemes in `field_validator`s.

### Content Security Policy

The scaffold already sets a strict CSP in `src/backend/src/main.py`. When adding third-party scripts (analytics, maps), prefer nonces or strict hashes; avoid `'unsafe-inline'` and `'unsafe-eval'`.

## 6. Secrets Management

### Configuration via environment

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    openai_api_key: str = ""
    clerk_jwks_url: str = ""
    database_url: str = ""
```

- Mark fields as `SecretStr` where supported and log-safe.
- Never print `settings` or pass it to the LLM.

### Production secret store

- Use infisical / Doppler / AWS Secrets Manager.
- Terraform variables for secrets use `sensitive = true`.
- Rotate LLM and Clerk keys on suspected compromise.

### Log redaction

```python
import structlog

SENSITIVE_KEYS = {"authorization", "cookie", "x-api-key", "password", "token", "secret"}

def redact_sensitive(_: str, __: str, event_dict: dict) -> dict:
    for key in event_dict:
        if key.lower() in SENSITIVE_KEYS:
            event_dict[key] = "***REDACTED***"
    return event_dict
```

## 7. AI Assistant Guardrails

### The transformer pattern

1. **Propose**: LLM returns JSON matching `ChangePreview`.
2. **Validate**: Pydantic parses; reject unknown fields and out-of-scope ops.
3. **Preview**: UI shows diff; user must explicitly approve.
4. **Apply**: Snapshot → `Revision` → apply allowlisted patch operations.

### Patch operation allowlist

```python
ALLOWLISTED_PATHS = {
    "/blocks/{block_id}/hero/headline",
    "/blocks/{block_id}/menu/categories",
    "/blocks/{block_id}/locations/*/hours/friday",
    # ...
}
```

- Reject any path not in the allowlist.
- Validate the `value` against the block's Pydantic schema.

### Prompt safety

- Strip control characters and limit length (2,000 chars).
- Include a strong system prompt that repeats the allowlist and prohibited actions.
- Never include other tenants' content, slugs, or internal instructions.
- Hash prompts and responses for audit logs; do not log full prompts if they contain PII.

## 7a. Security Audit Logging

Emit structured security events for abuse-detection and incident response:

| Event | When to log | Fields |
|---|---|---|
| `security.cross_tenant_attempt` | Any request where the authenticated tenant does not match the requested resource tenant | `actor_user_id`, `target_tenant_id`, `resource_type`, `resource_id`, `path` |
| `security.ssrf_blocked` | Ingestion URL validation rejects a private/internal/invalid URL | `actor_user_id`, `tenant_id`, `source_url`, `reason` |
| `security.ai_refused` | AI assistant rejects an out-of-scope or adversarial prompt | `actor_user_id`, `tenant_id`, `proposal_id`, `prompt_hash`, `reason` |
| `security.preview_token_used` | A preview token is verified | `site_id`, `tenant_id`, `result` (`valid` / `expired` / `invalid`) |

Use the same structured logger (`app.observability.get_logger`) and correlation ID for all events. Do not include raw prompts, tokens, or PII in event payloads.

## 8. Database / SQL Patterns

### Use SQLAlchemy 2 ORM; avoid raw SQL

- Never concatenate user input into SQL.
- Use parameterized queries via ORM or `text()` with bound parameters.

### Row-level tenant filtering

- Add `tenant_id` columns to all tenant-scoped tables.
- Add foreign keys and indexes on `(tenant_id, site_id)` for performance.

### Revision immutability

```python
class Revision(Base):
    __tablename__ = "revisions"
    id: Mapped[UUID] = mapped_column(primary_key=True)
    site_id: Mapped[UUID] = mapped_column(ForeignKey("sites.id"))
    tenant_id: Mapped[UUID] = mapped_column(ForeignKey("tenants.id"))
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    source: Mapped[str]
    triggered_by: Mapped[UUID]
    created_at: Mapped[datetime]
```

- `Revision` rows are insert-only.
- Revert creates a new revision, never mutates history.

## 9. API Security

### Rate limiting

```python
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=lambda: current_user.tenant_id)
```

- Apply stricter limits to public endpoints and AI propose/apply.
- Use Redis-backed limits in production.

### Error responses

```python
raise HTTPException(status_code=404, detail="Resource not found")
```

- Return generic messages to clients.
- Log full stack traces server-side with correlation IDs.

### Idempotency for mutations

- Use `Idempotency-Key` for site creation, onboarding, and AI apply where duplicate side effects are risky.

## 10. Frontend Security

### Next.js App Router

- Use Server Components for tenant-aware data fetching when possible.
- Pass Clerk session token to backend via `Authorization: Bearer <token>`.
- Never store API keys in client-side code.

### Image uploads

- Validate file type and size before upload.
- Generate unique filenames; store in tenant-prefixed object keys.
- Use signed URLs with short expiry for private previews.

### Admin dashboard

- Require authenticated layout that checks `get_current_user`.
- Show side-by-side diff before AI apply; require explicit confirm.

## 11. Dependency / Supply Chain

### Pin dependencies

- `requirements.txt` is generated with `--generate-hashes`.
- `package-lock.json` is committed.
- Review `package.json` additions in PRs.

### Scan before merge

| Tool | Scope | Gate |
|---|---|---|
| Bandit | Python SAST | Fail on medium+ |
| Semgrep | JS/TS SAST | Fail on high+ |
| Trivy | OS + dependency CVEs | Fail on CRITICAL/HIGH |
| dependency-review | PR dependency changes | Fail on high severity |
| CodeQL | Python + JS/TS | Weekly + PR |
| TruffleHog | Secrets | Fail on verified secrets |

### Keep dependencies current

- Review `npm audit` and `pip-audit` output weekly.
- Track CVE remediation SLA: Critical 24h, High 7 days.

## 12. Logging & Monitoring

### Security events to log

- Failed authentication / authorization attempts
- Cross-tenant access attempts
- AI propose/apply/reject events
- Ingestion job failures and SSRF blocks
- Preview token creation/use
- Site publish/unpublish

### Alerting

- Alert on > N 401/403 responses per tenant per minute.
- Alert on LLM error rate spike (circuit breaker threshold).
- Alert on ingestion job failure rate.

## 13. CI/CD Security Checklist

Before merging:

- [ ] SAST passes (Bandit, Semgrep, CodeQL).
- [ ] SCA passes (Trivy, dependency-review, `npm audit`, `pip-audit`).
- [ ] Secret scan passes (TruffleHog).
- [ ] No hardcoded secrets or TODOs with credentials.
- [ ] Cross-tenant / cross-role tests added or updated.
- [ ] AI prompt-injection / operation-allowlist tests added or updated.
- [ ] SSRF/URL validation tests added or updated for ingestion and block URLs.
- [ ] XSS output-encoding tests added or updated for content blocks.
- [ ] OpenAPI spec updated for new endpoints.
- [ ] New environment variables documented in `.env.example` and secret store.
- [ ] Security headers / CSP reviewed if new domains or scripts added.

## 14. Incident Response

If a security incident is suspected:

1. Contain: rotate secrets, disable affected feature flag, revoke sessions.
2. Preserve logs and revision snapshots.
3. Assess blast radius (tenant scope, data accessed).
4. Notify Security Champion and AppSec Engineering.
5. Follow `docs/RUNBOOKS/incident-response.md`.

## References

- `docs/THREAT_MODEL.md`
- `docs/SECURITY_REVIEW.md`
- `docs/adr/0003-ai-assistant-harness.md`
- OWASP ASVS 4.0
- OWASP Top 10 2021
