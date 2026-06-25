# Cross-Team Dependency Board

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Version | 0.3.0-rfc_adr |
| Author | TPM |
| Date | 2026-06-24 |
| Review cadence | Weekly during Cycle 1; bi-weekly in steady state |

> This board tracks **cross-team and external dependencies** that can block or delay Cycle 1 commitments. Technical dependencies inside the codebase are documented in `docs/DEPENDENCY_MAP.md` by the Tech Lead.

---

## Cycle 1 Commitments

| Bet | Appetite | Status | Sequencing |
|---|---|---|---|
| **Bet 1 — 10-Minute Publish Onboarding** | 6 weeks | Committed | Weeks 1–6; validation/polish weeks 7–8 |
| **Bet 2 — Live Open/Closed + Hours Management** | 3 weeks | Committed | Weeks 3–5 (starts after content-block model from Bet 1 is stable) |
| **Bet 3 — AI Website Assistant with Guardrails** | 1-week spike + 6-week build (conditional) | Spike | Weeks 1–2; build/no-build decision by end of week 2 |

---

## Dependency Matrix

### External APIs & Data Sources

| Dependency | What we need | Cycle 1 critical path | Owner | Status | Target date | Notes / blockers |
|---|---|---|---|---|---|---|
| **Google Business Profile / Places API** | Credentials, quota, verified access to fetch name, address, hours, photos. | Yes — Bet 1 ingestion | TPM / Tech Lead | **In progress** | Week 1 | SPIKE-002 gate. If access is denied, onboarding falls back to manual-only. |
| **Yelp Fusion API** | API key, rate-limit clarity, structured place data. | Yes — secondary ingestion | TPM / Backend Eng | **In progress** | Week 2 | Optional but improves first-pass data quality. |
| **DoorDash / UberEats / Grubhub links** | Deep-link format stability; no API required. | No — opaque URLs only | Product Owner | **Tracked** | N/A | Store links as-is; owners update if formats change. |
| **Instagram / Facebook / TikTok links** | Profile URL validation only. | No | Frontend Eng | **Tracked** | N/A | No API dependency; validate URL format and reachability optionally. |
| **Menu URL parsing** | HTML or PDF menu extraction; structure enough to seed menu block. | Yes — Bet 1 | Tech Lead | **Spike required** | Week 2 | SPIKE-002. Deep PDF/image extraction is out of scope for Cycle 1. |

### Platform & Infrastructure

| Dependency | What we need | Cycle 1 critical path | Owner | Status | Target date | Notes / blockers |
|---|---|---|---|---|---|---|
| **Clerk authentication** | Production project, webhook endpoints, roles, session policies. | Yes — signup/onboarding | Tech Lead | **Configured** | Week 1 | Clerk is critical; no viable fallback. Monitor status page. |
| **Vercel hosting + subdomain routing** | Project, edge middleware for `slug.foodcartsite.com`, preview deploys. | Yes — public site | Tech Lead / DevOps | **In progress** | Week 1 | Edge middleware design needed; test wildcard DNS. |
| **Cloudflare R2 (or AWS S3) object storage** | Bucket, CDN integration, signed upload URLs, public read. | Yes — logo/hero/menu images | DevOps / Backend Eng | **In progress** | Week 2 | S3-compatible. Fallback provider identified if needed. |
| **PostgreSQL + Redis** | Managed instances, migrations, backups, Redis for queue/rate limits. | Yes — backend persistence | DevOps | **Configured** | Week 1 | Docker-compose available; managed provider TBD for prod pilot. |
| **Unleash feature flags** | Toggle templates, ingestion sources, AI assistant. | No — nice-to-have | Tech Lead | **Configured** | Week 2 | Env-var fallback available if Unleash unavailable. |

### AI / LLM

| Dependency | What we need | Cycle 1 critical path | Owner | Status | Target date | Notes / blockers |
|---|---|---|---|---|---|---|
| **OpenAI / Anthropic structured-output API** | Account, API keys, cost ceiling, latency benchmark. | Yes — Bet 3 spike | Tech Lead | **Spike required** | Week 2 | SPIKE-001. Multi-provider abstraction planned. |
| **LLM guardrails / safety review** | Security Champion review of harness, red-team plan. | Yes — Bet 3 spike | Security Champion | **Scheduled** | Week 2 | SPIKE-005. Blocks Bet 3 build decision. |

### Internal / Enabling Teams

| Dependency | What we need | Cycle 1 critical path | Owner | Status | Target date | Notes / blockers |
|---|---|---|---|---|---|---|
| **UX Researcher — onboarding tests** | 5 pilot-owner task-based tests for time-to-publish and brand-match rating. | Yes — Bet 1 success criteria | UX Researcher | **Scheduled** | Weeks 6–7 | Recruiting begins in week 3. |
| **Product Owner — prioritization** | Final call on spike go/no-go and scope trade-offs. | Yes — build decisions | Product Owner | **Active** | End of week 2 | Decision gate for Bet 3 build. |
| **Design system / reference templates** | Three template implementations (Banh Mi Fusion, Real Indian Food, Mis Abuelos). | Yes — Bet 1 | Frontend Eng / Design | **In progress** | Week 4 | SPIKE-003 gate: content block schema must render all three templates. |
| **Legal / compliance — external data use** | Review of Google/Yelp/TOS for data ingestion and storage. | No — recommended | TPM | **Not started** | Week 3 | Risk PR-04. Does not block build if data is user-provided and deletable. |
| **Finance — LLM cost budget** | Approved monthly burn cap for OpenAI/Anthropic pilot usage. | Yes — Bet 3 build (not spike) | TPM / Product Owner | **Pending** | Week 2 | Spike costs minimal; production budget needed only if Bet 3 build is approved. |

---

## Escalation Triggers

| If this happens | Escalate to | Action |
|---|---|---|
| Google Business Profile API access delayed past Week 1 | Tech Lead + Product Owner | Switch Bet 1 to manual-first onboarding; revisit SPIKE-002 scope. |
| Vercel wildcard subdomain routing unsupported or unstable | Tech Lead + DevOps | Evaluate Cloudflare for SaaS or fly.io as alternative host. |
| SPIKE-002 shows < 70% credible first-pass data quality | Product Owner + Tech Lead | Reduce ingestion scope to GBP-only or defer automated ingestion. |
| SPIKE-004 / SPIKE-005 fail by end of Week 2 | Product Owner + Tech Lead | Move Bet 3 AI assistant build to Cycle 2. |
| Clerk production project blocked by security review | Security Champion + Tech Lead | Use staging tenant temporarily; document production readiness gaps. |
| Object storage or CDN provider unavailable by Week 2 | DevOps + Tech Lead | Switch to alternate S3-compatible provider; update DEPENDENCY_MAP. |
| UX researcher recruiting falls through | Product Owner + UX Researcher | Extend validation into Week 8 or use internal proxy tests; flag risk to metrics. |

---

## Dependency Decision Log

| Decision | Rationale | Owner |
|---|---|---|
| Google Business Profile is the primary ingestion source, Yelp secondary | GBP has richest structured data for restaurants; Yelp improves coverage; both have manual fallback. | Tech Lead |
| Delivery/social platforms treated as opaque links | No stable public APIs for small vendors; reduces integration surface area and TOS risk. | Product Owner + Tech Lead |
| Clerk production project required before pilot launch | Auth is critical path; no custom-auth fallback is planned. | Tech Lead |
| R2 preferred over S3 for cost | S3-compatible; cheaper egress aligns with image-heavy consumer sites. | DevOps |
| Bet 3 build budget approved only after spike success | Prevents committed burn before safety/accuracy are validated. | Product Owner + TPM |

---

## Last updated

2026-06-24 — created during RFC & ADR stage for Cycle 1 planning.
