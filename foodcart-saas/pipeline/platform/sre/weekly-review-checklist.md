# Weekly Review Checklist — Observe & Improve

## Purpose

Close the feedback loop between production behavior and engineering action. This
checklist is run every week by the on-call SRE or DevOps/SRE lead and feeds the
squad review, `METRICS.md`, and the improvement backlog.

## When

- **Duration:** 30–45 minutes.
- **Attendees:** On-call SRE, Tech Lead, Product Owner, Data Analyst (optional:
  UX Researcher, Platform Engineer).
- **Output:** Updated `METRICS.md`, filed friction logs, and prioritized
  improvement experiments.

## Checklist

### 1. Four golden signals (5 min)

- [ ] **Latency:** Review p50, p95, and p99 for API, AI assistant, and public-site
      rendering. Compare to SLOs in `docs/SLOs.md`.
- [ ] **Traffic:** Review requests per second, onboarding starts, publish events,
      and public-site visits. Flag anomalous drops or spikes (>30% baseline).
- [ ] **Errors:** Review 5xx rate, error breakdown by endpoint/tenant, and any
      new error classes. Compare to <0.1% SLO.
- [ ] **Saturation:** Review DB connection pool, CPU, memory, disk, and Vercel
      function utilization. Flag anything >80% p95.

### 2. SLOs and error budget (5 min)

- [ ] Confirm error-budget period (30 days, resets 1st of month).
- [ ] Review remaining budget for availability, latency, error rate, and LCP.
- [ ] If ≥50% burned this period, flag to Tech Lead + Product Owner and pause
      non-critical releases.
- [ ] If 100% burned, declare feature freeze until SLO is restored or budget
      resets; document decision in review notes.

### 3. Product metrics (5 min)

- [ ] **North Star:** Weekly Active Site Engagement (WASE) and trend.
- [ ] **Activation:** 24-hour publish rate and median time to publish.
- [ ] **Engagement:** Customer CTA click rate, menu view rate.
- [ ] **AI assistant:** Propose/approve events, guardrail trigger count, latency.
- [ ] **Core Web Vitals:** LCP, INP, CLS p75.

### 4. DORA and flow metrics (5 min)

- [ ] Deployment frequency and lead time for changes.
- [ ] Change failure rate and failed-deployment recovery time.
- [ ] WIP, cycle time, throughput, and flow efficiency.
- [ ] Compare to elite/team targets and identify bottlenecks.

### 5. Incident and alert review (5 min)

- [ ] List all SEV1/SEV2 incidents since last review.
- [ ] Confirm post-mortems filed within 48 hours for each.
- [ ] Verify action items have owners and due dates.
- [ ] Review noisy alerts: any alert fired >3 times without action? Tune or
      remove.
- [ ] Confirm every active alert still links to a runbook.

### 6. Friction logging / Kaizen (5 min)

- [ ] Review friction logs submitted by engineers since last review.
- [ ] Categorize: observability, deploy/release, developer experience, on-call,
      AI assistant guardrails, tenant isolation.
- [ ] Select 1–2 items for the next improvement sprint or blitz week.
- [ ] Update `docs/SRE_PLAYBOOK.md` §Kaizen with new experiments.

### 7. Improvement backlog (5 min)

- [ ] Convert findings into backlog items with hypothesis, success criteria, and
      owner.
- [ ] Tag reliability items with `reliability` and `slo-impact` if they affect
      an SLO.
- [ ] Prioritize using ICE (Impact, Confidence, Ease) or team weighting.

### 8. Communication (5 min)

- [ ] Summarize review in #sre-review or squad channel.
- [ ] Update `METRICS.md` with current values, signals, and decisions.
- [ ] Share action items with owners and due dates.
- [ ] Schedule follow-up for any SEV1/SEV2 post-mortem action-item review.

## Review log

| Date | Reviewer | SLO status | Error budget | Key decision |
|---|---|---|---|---|
| 2026-06-24 | SRE Platform | Baseline | 100% | Initial Cycle 1 checklist adopted |
