# Blameless Post-Mortem Template — Foodcart SaaS

## Purpose

Document incidents so the team learns and improves systems, not so individuals
are blamed. Every SEV1 and SEV2 incident, and any game-day finding that impacted
customers, requires a post-mortem within 48 hours of resolution.

## Metadata

| Field | Value |
|---|---|
| Incident title | |
| Incident ID | INC-YYYY-MM-DD-NNN |
| Date / time (UTC) | |
| Severity | SEV1 / SEV2 / SEV3 |
| Affected service(s) | |
| Affected tenant(s) / sites | |
| Incident commander | |
| Post-mortem author | |
| Reviewers | |
| Status | Draft / In review / Approved / Closed |

## Executive Summary

Two to three sentences summarizing what happened, the customer impact, and the
resolution. Written for a non-technical audience.

## Impact

### Customer impact

- Number of affected tenants / public sites:
- Number of failed requests / degraded requests:
- Data integrity / privacy impact:
- Error-budget consumed:

### Business impact

- Estimated revenue or signup impact:
- Support ticket volume:
- Status-page communication required? Yes / No

## Timeline

Use UTC. Include detection, page, key decisions, mitigations, and resolution.

| Time (UTC) | Event | Source |
|---|---|---|
| 00:00 | First symptom observed (e.g., alert fired, support ticket) | Alertmanager / PagerDuty |
| 00:05 | On-call acknowledged page | PagerDuty |
| 00:12 | Incident declared SEV1, #war-room opened | Slack #war-room |
| 00:25 | Mitigation started (e.g., feature flag disabled) | Runbook |
| 00:48 | Service recovered, error rate < 0.1% | Grafana |
| 01:30 | Incident resolved | Slack update |

## Root Cause

### What happened

Clear, factual description of the failure mechanism.

### Why it happened

- Contributing factors (deploy, config change, dependency, capacity, code bug).
- Why safeguards did not prevent it.
- Any recent changes that correlate (deploys, feature flags, experiments).

### Five Whys (optional)

1. Why did X happen? →
2. Why? →
3. Why? →
4. Why? →
5. Why? →

## Detection & Response

### How did we detect it?

- Alert name(s):
- Support channel:
- Manual observation:
- Detection gap (if any):

### Response effectiveness

- Was the runbook accurate and accessible? Yes / No
- Did escalation happen within target time? Yes / No
- Were feature-flag kill switches effective? Yes / No
- What slowed response?

## Lessons Learned

### What went well

- Bullet points only.

### What went poorly

- Bullet points only.

### Where we got lucky

- Bullet points only.

## Action Items

| ID | Action | Owner | Due date | Priority | Status |
|---|---|---|---|---|---|
| AI-1 | | | | P0/P1/P2 | Open |
| AI-2 | | | | P0/P1/P2 | Open |
| AI-3 | | | | P0/P1/P2 | Open |

### Action-item categories to consider

- **Prevent:** changes that would stop this class of failure from recurring.
- **Detect:** better alerts, synthetic probes, or guardrails.
- **Mitigate:** faster rollback, feature flags, rate limits, circuit breakers.
- **Remediate:** runbook updates, documentation, training.

## Appendix

### Relevant links

- Incident Slack thread:
- PagerDuty incident:
- Grafana dashboard snapshot:
- Trace / log queries:
- Deployment that preceded incident:
- Feature-flag state at time of incident:

### Data & logs

Paste or link key logs, traces, metrics screenshots, or SQL queries used during
triage. Keep PII out of this section.

## Blameless Checklist

- [ ] No individual is named as the cause.
- [ ] Focus is on system, process, and tooling improvements.
- [ ] Action items are specific, owned, and time-bound.
- [ ] Reviewed by incident commander and at least one engineer not involved in the response.
- [ ] Shared with the team within 48 hours of resolution.
- [ ] Follow-up review scheduled to verify action-item completion.

## Approval

| Role | Name | Approval date |
|---|---|---|
| Incident commander | | |
| Tech Lead | | |
| SRE Platform (for SEV1) | | |
