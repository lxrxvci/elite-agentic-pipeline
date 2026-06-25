# Runbook: Alert Tuning

## Purpose

Keep alerts actionable, reduce noise, and maintain a tight signal-to-noise
ratio. Every production alert must link to a runbook and fire only when human
intervention is likely required.

## Principles

1. **Alert on symptoms, not causes.** Prefer user-facing SLO breaches (latency,
   errors, availability) over internal signals (CPU, queue depth) unless the
   internal signal predicts an imminent SLO breach.
2. **Use multi-window or sustained thresholds.** Avoid single-point failures
   causing pages.
3. **Match severity to response time.** A page must require action within the
   page window.
4. **Every alert must have a runbook.** Link via `runbook_url` annotation.
5. **Treat flapping alerts as bugs.** If an alert fires and auto-resolves
   repeatedly, widen the window or add hysteresis.

## Alert review cadence

| Frequency | Activity |
|---|---|
| Weekly | Review `#incidents` and PagerDuty noise; count pages per alert. |
| Monthly | Evaluate alert thresholds against SLO attainment. |
| Quarterly | Full alert-catalog review with the squad. |
| After every incident | Verify the relevant alert fired, tuned, or was missing. |

## Tuning workflow

### Step 1: Measure alert quality

For each alert in the last 30 days, compute:

- **Precision:** `meaningful pages / total pages`
- **Recall:** `alerts that preceded or matched incidents / total incidents`
- **Noise:** pages with no follow-up action, auto-resolved within minutes.

Target:

| Metric | Target |
|---|---|
| Page precision | > 80% |
| Page recall for SEV1/SEV2 | > 90% |
| Weekly noisy pages | < 2 |

### Step 2: Decide the adjustment

| Problem | Likely fix |
|---|---|
| Too many false pages | Increase duration window or raise threshold; add a secondary condition. |
| Missing real incidents | Lower threshold, shorten window, or add a counter-part alert. |
| Alert flapping | Increase `for` duration; add hysteresis; aggregate over a longer window. |
| Alert fires but is not actionable | Add runbook steps; automate remediation; or downgrade to a ticket. |
| Too many warning alerts | Promote warnings only when correlated with SLO risk; otherwise send to dashboard. |

### Step 3: Test in staging

- Reproduce the failure mode in staging or during a game day.
- Confirm the tuned alert fires within the expected window.
- Confirm it does not fire under normal load.

### Step 4: Document and roll out

- Update `docs/SRE_PLAYBOOK.md` alert-to-runbook mapping if severity or runbook
  changes.
- Update the Prometheus rule in
  `pipeline/platform/sre/prometheus/recording-alerting-rules.yml` via PR.
- Add a note to the weekly review log explaining the change.

## Foodcart SaaS alert thresholds

The table below summarizes the current thresholds from `docs/SLOs.md` and
`docs/SRE_PLAYBOOK.md`. Treat these as starting points; tune based on live data.

| Alert | Severity | Current threshold | SLO | Suggested tuning notes |
|---|---|---|---|---|
| `FoodcartAvailabilityBelowSLO` | critical | < 99.9% over 5 min | 99.9% monthly | Keep tight; page if sustained. |
| `FoodcartErrorRateCritical` | critical | 5xx > 0.5% over 5 min | < 0.1% monthly | If noisy, raise to 1% or require 10 min window. |
| `FoodcartErrorRateHigh` | warning | 5xx > 0.1% over 5 min | < 0.1% monthly | Good leading indicator; may become a ticket if too noisy. |
| `FoodcartLatencyP95Critical` | critical | p95 > 500 ms over 5 min | p95 < 300 ms | Add tenant/path grouping if one endpoint dominates. |
| `FoodcartLatencyP95High` | warning | p95 > 300 ms over 5 min | p95 < 300 ms | Tune by endpoint; AI endpoints have a separate alert. |
| `FoodcartAIAssistantLatencyHigh` | warning | p95 > 5 s over 5 min | p95 < 5 s | Consider split: proposal vs. apply endpoints. |
| `FoodcartAIAssistantGuardrailTriggered` | critical | Any block/audit-fail | Zero tolerance | Never tune down; ensure audit webhook is wired. |
| `FoodcartFrontendLCPHigh` | warning | p75 LCP > 2.5 s over 10 min | LCP < 2.5 s | Add template dimension if one template regresses. |
| `FoodcartDatabasePoolCritical` | critical | Pool > 85% over 5 min | < 80% | If pool can scale quickly, consider warning first. |
| `FoodcartDatabasePoolSaturation` | warning | Pool > 80% over 5 min | < 80% | Leading indicator; tune before it becomes critical. |
| `FoodcartTrafficDrop` | warning | RPS < 70% baseline over 5 min | Monitoring | Use baseline from same hour/day; avoid holiday false positives. |
| `FoodcartErrorBudgetBurn50` | critical | 50% monthly budget burned | 0.1% budget | Page on-call; no threshold tuning needed. |
| `FoodcartErrorBudgetExhausted` | critical | 100% monthly budget burned | 0.1% budget | Feature freeze trigger. |
| `FoodcartPublicSiteDown` | critical | Probe fails for 2 min | 99.9% | Tune probe regions if one region blips. |

## Common tuning patterns

### Add a burn-rate window

For availability SLOs, use a short window plus a long window to catch fast
burns without noise:

```yaml
# Example: page if 2% error rate over 1h OR 5% over 5m
- alert: FoodcartAvailabilityFastBurn
  expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.05
  for: 2m
  labels:
    severity: critical
```

### Add tenant/path labels

If one tenant or one endpoint is noisy, split the alert by label:

```yaml
expr: |
  histogram_quantile(0.95,
    sum by(le, path) (
      rate(http_request_duration_seconds_bucket[5m])
    )
  ) > 0.5
```

### Hysteresis with `max_over_time`

Require an alert condition to hold over a longer window to avoid flapping:

```yaml
expr: max_over_time(up[10m]) == 0
for: 0m
```

## Anti-patterns

- **Alerting on every 5xx spike** without grouping by error type or endpoint.
- **Pages that do not require immediate action.** If it can wait until business
  hours, make it a warning or a ticket.
- **Thresholds copied from another service** without validating against
  Foodcart's traffic shape.
- **Tuning alerts down during an incident** without a follow-up review.

## Escalation

If tuning an alert changes its severity or runbook mapping, notify the Tech
Lead and update `docs/SRE_PLAYBOOK.md` before merging.
