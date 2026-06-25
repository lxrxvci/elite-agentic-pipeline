# Alert Tuning Guide — SRE Platform

## Purpose

Keep alerts actionable, accurate, and aligned with SLOs. This guide defines the
alert lifecycle, tuning heuristics, and review cadence for the Foodcart SaaS
squad.

## Alert design principles

1. **Every alert links to a runbook.** No exceptions.
2. **Alert on symptoms, not causes.** Prefer customer-impacting signals (error
   rate, latency, availability) over internal metrics alone.
3. **Severity reflects response urgency**, not internal priority.
4. **Reduce noise.** An alert that fires frequently without action is a candidate
   for tuning, suppression, or removal.
5. **Use multi-window burn rates** for error-budget alerts to avoid flapping.

## Alert lifecycle

| Stage | Activity | Owner | Cadence |
|---|---|---|---|
| Propose | Define SLI, SLO, threshold, severity, runbook | DevOps/SRE + SRE Platform | Per new service or SLO |
| Review | Check for overlap, noise, and runbook coverage | SRE Platform | Weekly |
| Deploy | Add rule to Prometheus/Alertmanager | DevOps/SRE | Per PR |
| Tune | Adjust threshold, window, or routing based on data | On-call SRE | Continuous |
| Retire | Remove obsolete alerts | DevOps/SRE | Quarterly |

## Severity definitions

| Severity | Response time | Example | Channel |
|---|---|---|---|
| Critical (P1) | 15 minutes | Site down, tenant isolation failure, AI guardrail bypass | PagerDuty + #war-room |
| High (P2) | 1 hour | SLO breach trending, single-region degradation | PagerDuty + #incidents |
| Warning (P3) | 4 hours | Elevated error rate below SLO, capacity warning | #incidents |
| Info (P4) | Best effort | Anomaly noted for review, no immediate action | Dashboard / backlog |

## Tuning heuristics

### Latency alerts

- Use histogram percentiles over at least 5-minute windows.
- Set warning at SLO threshold; critical at 1.5–2× SLO.
- Exclude long-polling, WebSocket, and large-batch endpoints from the same rule
  or use separate recording rules.

### Error-rate alerts

- Base on ratio of 5xx to total responses, not absolute count.
- Use `for: 5m` to ignore transient spikes from deploys or retries.
- Group by `route` or `service` to localize quickly.

### Error-budget burn alerts

- Use multi-window approach:
  - **Fast burn:** 2% budget in 1 hour → page immediately.
  - **Slow burn:** 5% budget in 6 hours → page during business hours.
- Reset monthly on the 1st; do not page for scheduled maintenance windows.

### Saturation alerts

- Trigger warning at 80% and critical at 85–90% of capacity.
- Include forecast rules where possible (e.g., disk will fill in 4 hours).
- Alert on queue depth and backlog for ingestion workers.

### Traffic anomaly alerts

- Use baseline comparison (hour-of-day, day-of-week) rather than fixed
  thresholds.
- Treat drops as warnings unless correlated with error-rate spikes.

## Runbook annotation contract

Every Prometheus alert rule must include:

```yaml
annotations:
  summary: "One-line description"
  description: "Human-readable detail with current value"
  runbook_url: "https://wiki.internal/runbooks/foodcart/incident-response"
  dashboard_url: "https://grafana.internal/d/foodcart-api"
  severity: "critical"
```

## Tuning review checklist

Run this monthly or after any noisy on-call shift:

- [ ] List alerts that fired >3 times in the last 30 days.
- [ ] For each, note whether it led to a meaningful action.
- [ ] Identify alerts with >50% false-positive rate.
- [ ] Confirm thresholds still match current SLOs and traffic patterns.
- [ ] Verify runbook links resolve and are up to date.
- [ ] Check alert routing: right channel, right on-call rotation, right
      escalation.
- [ ] Document tuning decisions in `docs/SRE_PLAYBOOK.md` or squad on-call log.

## Anti-patterns

- **Alerting on every error.** Not all errors are customer-impacting; aggregate
  and threshold.
- **No runbook link.** Leads to panic and longer time to mitigate.
- **Overly sensitive thresholds.** Creates alert fatigue and desensitizes the
  team.
- **Static thresholds for traffic-dependent metrics.** Use percentile or
  baseline-aware rules instead.

## Tools

- Prometheus rule linter: `promtool check rules rules.yml`
- Grafana alert test: use "Test rule" in UI or provisioning validation.
- Noise tracker: query PagerDuty/Alertmanager for alert frequency by name.
