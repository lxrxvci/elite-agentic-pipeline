# Program Plan — Cycle 1

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Cycle | Cycle 1 (0–8 weeks) |
| Version | 0.3.0-rfc_adr |
| Author | TPM |
| Date | 2026-06-24 |

> This plan coordinates the three shaped bets committed or spiked in Cycle 1. Detailed technical planning lives in `docs/SHAPED_BETS.md`, `docs/DEPENDENCY_MAP.md`, and the backlog.

---

## Cycle 1 Goals

1. **Prove the 10-Minute Publish loop.** A new food-cart owner can sign up, ingest or manually enter their presence, generate a site from one of three templates, and publish before their next shift.
2. **Ship accurate live open/closed status.** Customers never waste a trip because of stale hours.
3. **Validate the AI assistant harness.** Run spikes that prove structured-change accuracy and guardrail safety before committing a 6-week build.

---

## Bets & Sequencing

```
Week:  1    2    3    4    5    6    7    8
       ├────SPIKE-002/003────┤
Bet 1  ├──────────────────────────────BUILD────────────────────────┤
Bet 2       └────SCHEMA CONTRACT────├────BUILD────┤
Bet 3  ├────SPIKE-001/004/005────┤
                                  ├────BUILD (conditional)────┤
       └────INFRA/CLERK/R2/VERCEL SETUP────┘
                                  └────VALIDATION / PILOT────┘
```

| Bet | Appetite | Starts | Ends | Sequencing note |
|---|---|---|---|---|
| **Bet 1 — 10-Minute Publish Onboarding** | 6 weeks | Week 1 | Week 6 (validation Weeks 6–8) | Foundation bet; blocks Bet 2 schema work and Bet 3 content mutations. |
| **Bet 2 — Live Open/Closed + Hours** | 3 weeks | Week 3 | Week 5 | Starts after Bet 1 content-block schema is stable. |
| **Bet 3 — AI Website Assistant** | 1-week spike + optional 6-week build | Spike Weeks 1–2 | Build Weeks 3–8 if approved | Build only if spike success criteria met and capacity is available. |

---

## Key Milestones

| Milestone | Target week | Owner | Exit criteria |
|---|---|---|---|
| **M1 — Infrastructure ready for development** | Week 1 | DevOps + Tech Lead | Local docker-compose, staging Vercel project, Clerk project, R2/S3 bucket, CI green. |
| **M2 — SPIKE-002/003 decision** | End of Week 2 | Tech Lead + Product Owner | ≥ 70% credible first-pass ingestion quality; content block schema renders all 3 templates. |
| **M3 — Bet 3 spike decision** | End of Week 2 | Product Owner + Tech Lead | SPIKE-004 ≥ 90% schema conformance; SPIKE-005 0 guardrail breaches; capacity confirmed. |
| **M4 — Content block schema contract locked** | Week 3 | Tech Lead | Frontend + backend agree on schema for hero, story, menu, locations, contact, order_links, footer. |
| **M5 — Onboarding end-to-end demo** | Week 4 | Tech Lead + Frontend Eng | Signup → slug → ingestion/manual → template → preview → publish works in staging. |
| **M6 — Live hours shipped to staging** | Week 5 | Backend Eng + Frontend Eng | Timezone-aware badge, admin editor, special-hours overrides, accuracy tests passing. |
| **M7 — Bet 1 code-complete** | Week 6 | Tech Lead | All acceptance criteria demonstrable in staging; Lighthouse/a11y gates pass. |
| **M8 — Pilot validation complete** | Week 8 | UX Researcher + Product Owner | 5+ task-based tests, 24-hour publish rate measured, brand-match survey collected. |

---

## Workstreams

### Workstream A: Onboarding & Public Site (Bet 1)

| Week | Focus | Deliverables | Dependencies |
|---|---|---|---|
| 1 | Clerk integration, slug reservation, tenant creation | Auth flow, unique slug, DB schema | Clerk prod project ready |
| 2 | Ingestion adapters + manual fallback; SPIKE-002 | GBP/Yelp/menu URL adapters, fallback UI | API credentials, SPIKE-002 results |
| 3 | Template rendering engine; SPIKE-003 validation | Content block → template mapping for 3 templates | Schema contract |
| 4 | Preview/publish flow, admin dashboard shell | End-to-end demo, publish toggle, 404 for unknown slugs | Vercel subdomain routing |
| 5 | Image upload, asset pipeline, CWV tuning | R2 upload, Next.js Image, Lighthouse CI | R2/S3 + CDN ready |
| 6 | Polish, instrumentation, security/integration tests | Funnel events, tenant isolation tests, code-complete | UX Researcher test plan |

### Workstream B: Live Hours & Locations (Bet 2)

| Week | Focus | Deliverables | Dependencies |
|---|---|---|---|
| 3 | Schema contract with Bet 1; hours data model | `locations` block with timezone, weekly schedule, special hours | Bet 1 schema stable |
| 4 | Hours editor UI (mobile-first) | Day rows, open/closed toggles, copy-across-days, special-hours overrides | Design system components |
| 5 | Open/closed badge, ISR/cache invalidation | Public badge with helper text; timezone tests; cache invalidation on change | Bet 1 public site rendering |

### Workstream C: AI Assistant Spike (Bet 3 conditional)

| Week | Focus | Deliverables | Dependencies |
|---|---|---|---|
| 1 | SPIKE-001: provider benchmark; harness scaffold | Cost/accuracy/latency comparison; PoC propose endpoint | OpenAI/Anthropic API keys |
| 2 | SPIKE-004: change-preview accuracy; SPIKE-005: red-team | > 90% valid ChangePreview; 0 unauthorized actions across 50 adversarial prompts | Security Champion time |
| 3–8 (if approved) | Build AI assistant | Prompt → diff → approve → apply → revision flow; tenant quotas; audit logging | Bet 1 content schema; Redis rate-limiting |

---

## Dependency & Risk Integration

- **Dependencies** are tracked in `DEPENDENCIES.md` and `docs/DEPENDENCY_MAP.md`.
- **Program risks** are tracked in `docs/RISK_REGISTER.md`.
- **Technical risks** are tracked in `docs/TECHNICAL_RISK_REGISTER.md`.

| Top cross-team dependencies to watch | Risk if late |
|---|---|
| Google Business Profile / Yelp API access (Week 1) | Bet 1 scope shrinks to manual-only. |
| Vercel wildcard subdomain routing (Week 1) | Public site publishing blocked. |
| SPIKE-002/003 results (Week 2) | Bet 1 build scope or quality at risk. |
| Security Champion AI review (Week 2) | Bet 3 build decision delayed. |
| Pilot-owner recruiting (Weeks 3–6) | Cycle 1 success metrics unmeasured. |

---

## Communication Plan

| Cadence | Audience | Format | Owner | Purpose |
|---|---|---|---|---|
| Daily standup | Squad | Async written update | Rotating engineer | Blockers, progress, help needed. |
| Weekly scope/dependency review | Tech Lead, Product Owner, TPM | 30-min sync | TPM | Dependency status, risk burn-down, scope changes. |
| Spike decision gates (Week 2) | Product Owner, Tech Lead, Security Champion, TPM | Written RFC/ADR comments + 45-min review | Tech Lead | Decide build/no-build for Bet 3. |
| Bi-weekly stakeholder demo | Squad + stakeholders | 30-min demo | Product Owner | Show working software, collect feedback. |
| Cycle retrospective | Squad | 60-min retro | TPM | Learnings for Cycle 2 planning. |

**Coordination principle:** Prefer async written updates. Default to RFC/ADR comments and Slack/Notion updates rather than meetings. Protect engineer flow time.

---

## Resource Plan

| Role | Cycle 1 focus | Estimated load |
|---|---|---|
| Tech Lead | Architecture, spikes, ADRs, code review, subdomain routing | High |
| Frontend Engineer | Admin dashboard, consumer templates, hours editor, AI diff UI (if approved) | High |
| Backend Engineer | Ingestion, content API, hours/status, AI propose/apply (if approved) | High |
| DevOps / SRE | Staging/prod infra, Vercel, R2, CI/CD, observability | Medium-High |
| Security Champion | AI harness review, tenant isolation review, threat model updates | Medium |
| UX Researcher | Pilot recruiting, task-based tests, trust/usability feedback | Medium |
| Product Owner | Sequencing, scope decisions, stakeholder demos, pilot coordination | High |
| TPM | Dependency board, risk register, program plan, coordination | Medium |

---

## Success Metrics

| Metric | Target | Owner |
|---|---|---|
| Median time to publish | < 10 minutes | UX Researcher |
| 24-hour publish rate | ≥ 60% of signups | Product Owner / Analytics |
| Owner brand-match rating | ≥ 70% "good or great" | UX Researcher |
| Open/closed badge accuracy | 100% vs. owner-verified hours | Backend Eng / QA |
| AI spike — valid ChangePreview rate | ≥ 90% | Tech Lead |
| AI spike — unauthorized actions | 0 across 50 adversarial prompts | Security Champion |
| Mobile Core Web Vitals LCP | < 2.5 s | Frontend Eng |

---

## Open Decisions

| Decision | Needed by | Owner | Options |
|---|---|---|---|
| Production hosting provider (Vercel vs. alternative) | Week 2 | Tech Lead + DevOps | Vercel (preferred); Cloudflare Pages / fly.io fallback |
| Object storage provider (R2 vs. S3) | Week 2 | DevOps | R2 (preferred); S3 fallback |
| AI assistant build approval | End of Week 2 | Product Owner + Tech Lead | Build in Cycle 1 / defer to Cycle 2 |
| Pilot owner compensation / incentive | Week 3 | Product Owner | Gift card / free service / none |

---

## Last updated

2026-06-24 — created during RFC & ADR stage for Cycle 1 planning.
