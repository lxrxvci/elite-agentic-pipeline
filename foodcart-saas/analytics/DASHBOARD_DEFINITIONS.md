# Release Dashboard Definitions: Foodcart SaaS

*Cycle 1 release dashboard. Keep visible metrics to 6–8 max.*

This dashboard is used by the Product Owner, Tech Lead, DevOps/SRE, and Data Analyst during progressive delivery rings and after general availability.

---

## 1. Weekly Active Site Engagement (WASE) — North Star

| Attribute | Value |
|---|---|
| **Definition** | % of published tenant sites with ≥1 customer interaction or owner update in the last 7 days |
| **Formula** | `active_published_sites_7d / total_published_sites_at_start_of_window` |
| **Target** | ≥ 35% |
| **Alert threshold** | < 25% for 7 consecutive days |
| **Data source** | Nightly job over Plausible/Segment public-site events + PostHog/Amplitude dashboard events + AI audit log |
| **Owner** | Product Strategist / Data Analyst |
| **Why here** | Single headline metric that captures both customer value and owner value. |

---

## 2. Onboarding Conversion

| Attribute | Value |
|---|---|
| **Definition** | % of unique signups that complete the onboarding wizard (reach preview or publish step) |
| **Formula** | `signups_who_completed_wizard / total_signups` |
| **Target** | > 75% |
| **Alert threshold** | < 60% for 24 h |
| **Data source** | PostHog/Amplitude onboarding funnel events (`signup_start`, `onboarding_step_*`, `site_previewed`) |
| **Owner** | Product / UX |
| **Why here** | Leading indicator of WASE; if owners don't finish onboarding, nothing downstream matters. |

---

## 3. Publish Rate

| Attribute | Value |
|---|---|
| **Definition** | % of signups that publish a site within 24 hours of signup |
| **Formula** | `signups_with_published_site_within_24h / total_signups` |
| **Target** | > 60% |
| **Alert threshold** | < 45% for 24 h |
| **Data source** | Backend `sites` table + dashboard telemetry |
| **Owner** | Product / UX |
| **Why here** | Core activation gate from the roadmap; directly tied to retention. |

---

## 4. AI Assistant Usage

| Attribute | Value |
|---|---|
| **Definition** | % of active owners who use the AI assistant (propose or apply) in a 30-day window |
| **Formula** | `active_owners_with_ai_event_30d / total_active_owners_30d` |
| **Target** | > 35% |
| **Alert threshold** | < 20% after 2 weeks of GA |
| **Data source** | AI audit log + frontend telemetry (`ai_prompt_sent`, `ai_preview_shown`, `ai_change_applied`) |
| **Owner** | Product |
| **Why here** | Key differentiator and engagement driver; low usage signals trust or discoverability issues. |

---

## 5. Error Rate

| Attribute | Value |
|---|---|
| **Definition** | % of HTTP responses that are 5xx across public + admin + API endpoints |
| **Formula** | `5xx_responses / total_responses` |
| **Target** | < 0.1% over 30 days |
| **Alert threshold** | > 0.5% for 5 minutes |
| **Data source** | Access logs / APM / Prometheus |
| **Owner** | DevOps/SRE |
| **Why here** | Primary release-health signal; drives rollback decisions during canary/ring rollout. |

---

## 6. API p95 Latency

| Attribute | Value |
|---|---|
| **Definition** | p95 response time for all API requests |
| **Formula** | 95th percentile of request duration |
| **Target** | < 300 ms |
| **Alert threshold** | > 500 ms for 5 minutes |
| **Data source** | Prometheus histograms / OpenTelemetry |
| **Owner** | DevOps/SRE |
| **Why here** | Core SLO; latency spikes are often the first symptom of a bad release. |

---

## 7. Largest Contentful Paint (LCP)

| Attribute | Value |
|---|---|
| **Definition** | p75 LCP for public tenant sites and admin dashboard |
| **Formula** | 75th percentile of LCP values from real-user monitoring |
| **Target** | < 2.5 s |
| **Alert threshold** | > 4 s for 5 minutes |
| **Data source** | Vercel Analytics / Chrome UX Report / `web-vitals` library |
| **Owner** | Frontend / UX |
| **Why here** | Mobile-first product; LCP is a proxy for first impression and SEO. |

---

## 8. Tenant Count

| Attribute | Value |
|---|---|
| **Definition** | Total provisioned tenants + count of published tenants |
| **Formula** | `count(tenants)` and `count(tenants where site_published = true)` |
| **Target** | TBD after launch baseline |
| **Alert threshold** | N/A (diagnostic, not a target) |
| **Data source** | PostgreSQL `tenants` / `sites` tables |
| **Owner** | Data Analyst |
| **Why here** | Denominator for WASE and publish rate; helps distinguish metric moves caused by volume vs. behavior. |

---

## Dashboard Layout Recommendation

| Row | Metrics |
|---|---|
| Top row | WASE, Publish Rate, Onboarding Conversion |
| Middle row | Error Rate, API p95 Latency, LCP |
| Bottom row | AI Assistant Usage, Tenant Count |

Use percentiles (p50/p95/p99) for latency distributions; never show averages.
