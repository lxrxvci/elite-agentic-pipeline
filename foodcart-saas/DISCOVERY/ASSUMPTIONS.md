# Riskiest Assumptions

*Ranked by impact (how much they affect success) and uncertainty (how little evidence we have). Revisited during Observe & Improve after Cycle 1 implementation.*

## Impact × Uncertainty Matrix

| Rank | Assumption | Impact | Uncertainty | Status | Evidence So Far | Validation Method |
|---|---|---|---|---|---|---|
| 1 | Food-cart owners need a standalone website badly enough to sign up and publish one | High | High | Open — post-launch validation | 7/9 synthesized interviews report no current website or an outdated one; several rely on Instagram only ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [PRODUCT_STRATEGY.md](../PRODUCT_STRATEGY.md)) | Signup funnel + 24-hour publish-rate analysis post-launch; Sean Ellis PMF survey |
| 2 | Owners will trust an AI assistant to make changes to their live site | High | High | Open — Cycle 2 build + post-launch trust tests | 6/9 owners feared "breaking something"; most said they would use AI if changes were previewed and reversible ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [docs/adr/0003-ai-assistant-harness.md](../docs/adr/0003-ai-assistant-harness.md)) | Trust-rating UX tests + AI propose/approve/revert adoption metrics |
| 3 | A 10-minute publish experience is the strongest acquisition and activation hook | High | Medium | Partially de-risked — onboarding shipped; pending telemetry correlation | Interviewees valued speed; 2 abandoned Squarespace because it took "too long" ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [BACKLOG.md](../BACKLOG.md) Bet 1) | Time-to-publish telemetry + activation/retention correlation |
| 4 | Owners want to update menus, hours, and hero copy via natural language | High | Medium | Partially de-risked — AI assistant allowlist and harness accepted; pending usage validation | Menu updates cited as #1 login reason; hours updates tied to holidays/weather ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [docs/adr/0003-ai-assistant-harness.md](../docs/adr/0003-ai-assistant-harness.md)) | AI edit usage + qualitative follow-up interviews |
| 5 | Catering lead capture is an untapped revenue driver worth paying for | Medium | High | Open — catering section in backlog; pending pricing validation | 5 solo operators and 1 mini-chain handle catering informally; no formal pricing power tested ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md)) | Pro-tier conversion by feature usage; catering pricing interviews |
| 6 | Mobile-first, food-specific templates outperform generic templates for this ICP | High | Medium | Partially de-risked — 3 templates implemented; pending engagement data | Reference designs praised in concept testing; no A/B data yet ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [BACKLOG.md](../BACKLOG.md) Bet 1; [design/DESIGN_SPECS.md](../design/DESIGN_SPECS.md)) | Template selection rates + site engagement by template + brand-match rating |
| 7 | Owners will pay $29–79/month once value is proven | Medium | High | Open — no pricing experiments run | Interviewees receptive to "less than a delivery app order per month" concept ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [PRODUCT_STRATEGY.md](../PRODUCT_STRATEGY.md)) | Pricing-sensitivity survey + free-to-paid conversion cohorts |
| 8 | Tenant isolation and guardrails are sufficient to prevent cross-tenant data leaks | High | Low | De-risked by Cycle 1 implementation | Threat model drafted; architecture uses per-tenant subdomains and row-level policies; Cycle 1 integration/security tests and scans passed ([docs/THREAT_MODEL.md](../docs/THREAT_MODEL.md); [BACKLOG.md](../BACKLOG.md) Bet 1; [METRICS.md](../METRICS.md)) | Security review + penetration test before GA |
| 9 | Owners will return to the dashboard after publishing to keep the site fresh | High | High | New — post-launch validation | Time poverty cited universally; no longitudinal behavior data yet ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [METRICS.md](../METRICS.md) WASE) | 7-/14-/30-day owner retention; Weekly Active Site Engagement (WASE) |
| 10 | Live open/closed badge accuracy will improve customer trust and CTA clicks | High | Medium | New — post-launch validation | Wrong hours identified as top pain; Cycle 1 implemented timezone-aware badge ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [BACKLOG.md](../BACKLOG.md) Bet 2; [METRICS.md](../METRICS.md)) | CTA click-rate cohort analysis; wrong-hours complaints; badge accuracy audit |
| 11 | Ingestion fallback UX is acceptable when APIs fail or data is partial | High | Medium | New — post-launch validation | Cycle 1 onboarding requires manual fallback if ingestion fails ([BACKLOG.md](../BACKLOG.md) Bet 1); no qualitative data on fallback completion | Fallback usage rate + completion rate + post-onboarding micro-survey |
| 12 | Non-technical owners will understand and use "draft diff + approve" AI interaction model | High | High | New — post-launch validation | Fear of AI mistakes observed; Cycle 2 AI assistant uses preview/approval ([INTERVIEW_SYNTHESIS.md](INTERVIEW_SYNTHESIS.md); [docs/adr/0003-ai-assistant-harness.md](../docs/adr/0003-ai-assistant-harness.md)) | Usability tests (SUS ≥ 70, trust rating ≥ 70); AI adoption rate |
| 13 | Template selection friction can be reduced with smart defaults/quiz without hurting brand-match | Medium | High | New — post-launch validation | METRICS Week 1 review flags manual template choice as a bottleneck ([METRICS.md](../METRICS.md); [BACKLOG.md](../BACKLOG.md) EXP-002 queued) | A/B test quiz/default vs manual selection; brand-match rating; time-to-publish |
| 14 | Mobile Core Web Vitals will meet targets on real customer devices and networks | Medium | Medium | New — post-launch validation | Frontend lint warnings flag unoptimized `<img>` tags as LCP risk ([METRICS.md](../METRICS.md)) | Chrome UX Report field data; LCP/INP/CLS by template |

## Most Critical Assumptions to Validate First (Post-Launch)

1. **Need:** Do food carts actually need a standalone website, or is Instagram + Google enough? *(#1, #9)*
2. **Trust:** Will non-technical owners let an AI edit their public site, and will they understand the diff preview? *(#2, #12)*
3. **Speed:** Does "publish in 10 minutes" meaningfully improve activation vs. a longer setup? *(#3)*
4. **Freshness:** Do owners return to update their site after the first week? *(#9)*
5. **Accuracy:** Does live open/closed status affect customer trust and clicks? *(#10)*

## Assumptions Already Supported

- **Mobile dominates.** All interviewed owners said 80%+ of their customers find them on phones.
- **Fragmentation is real.** Owners maintain menu info separately on Google, Instagram, DoorDash, and UberEats.
- **Delivery apps are expensive but necessary.** Owners want to own more of the customer relationship.

## Assumptions De-risked by Cycle 1 Implementation

| Assumption | How Cycle 1 De-risked It | Remaining Uncertainty |
|---|---|---|
| Tenant isolation & guardrails (#8) | Per-tenant subdomains, row-level policies, integration/security tests, and clean scans ([METRICS.md](../METRICS.md); [BACKLOG.md](../BACKLOG.md)) | External penetration test before GA |
| 10-minute publish hook (#3) | Onboarding wizard, template picker, preview, and publish flow shipped; mobile task-based test shows < 60 s hours update ([BACKLOG.md](../BACKLOG.md) Bet 1) | Correlation with real activation/retention |
| Food-specific templates (#6) | Three reference-inspired templates implemented and validated against content-block schema ([BACKLOG.md](../BACKLOG.md) Bet 1; [design/DESIGN_SPECS.md](../design/DESIGN_SPECS.md)) | Live selection rates, brand-match, engagement |

## Assumptions That Could Kill the Product

| Assumption | If False | Mitigation |
|---|---|---|
| Owners need a website / keep it updated | Market is too small or satisfied with free tools | Pivot to "supercharge Instagram/Google" rather than replace them |
| Owners trust AI edits | AI assistant becomes a liability, not a differentiator | Double down on manual dashboard; make AI a pure suggestion engine |
| Owners will pay monthly | Revenue model fails | Test usage-based, transaction-based, or freemium ad-supported models |

## Last Updated

2026-06-24 — Observe & Improve review after Cycle 1 release; added post-launch assumptions and de-risked status.
