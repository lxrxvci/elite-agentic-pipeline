# Workflow: Observe & Improve

## Purpose

Close the feedback loop between production behavior and engineering action.

## Trigger

- Continuous production monitoring
- Incident or anomaly
- Weekly team review

## Participants

- DevOps/SRE (lead on monitoring)
- Data Analyst
- Product Strategist
- UX Researcher
- SRE Platform (observability templates and post-mortem process)
- All engineers for post-mortems

## Steps

1. **Monitor four golden signals**
   - Latency (p50/p95/p99)
   - Traffic
   - Errors
   - Saturation

2. **Track SLOs and error budgets**
   - Alert when budgets are consumed.
   - Freeze feature work when budget is exhausted.

3. **Collect product metrics**
   - HEART metrics, Core Web Vitals, North Star sub-metrics.

4. **Weekly review**
   - Review DORA metrics, flow metrics, and UX trends.
   - Identify bottlenecks and improvement opportunities.

5. **Blameless post-mortems**
   - For every significant incident.
   - Use Five Whys to find root cause.
   - Produce timeline, root causes, and action items.
   - Authored by DevOps/SRE using the SRE Platform template.

6. **Kaizen / friction logging**
   - Engineers log friction points.
   - Run periodic blitz weeks or improvement sprints.

## Exit criteria

- `METRICS.md` updated weekly
- Post-mortem action items tracked to closure
- Improvement experiments added to backlog

## Frequency

Continuous monitoring; weekly review; per-incident post-mortem.
