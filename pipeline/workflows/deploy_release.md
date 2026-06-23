# Workflow: Deploy & Release

## Purpose

Decouple deployment from release and progressively expose changes to users with minimal blast radius.

## Trigger

- A merge to main produces a releasable artifact.
- A release is approved.

## Participants

- DevOps/SRE (lead)
- Tech Lead
- Product Owner
- Data Analyst
- SRE Platform (SLO templates and incident-response playbooks)

## Steps

1. **Deploy to production**
   - CI/CD deploys artifact automatically or on approval.
   - New code is wrapped in feature flags and inactive by default.

2. **Progressive delivery rings**
   - Ring 0: internal team (5–20 users) for 24–48 hours.
   - Ring 1: 1–5% of users, monitor error rate <0.1%.
   - Ring 2: 10–25% of users.
   - Ring 3: general availability.

3. **Canary analysis (for high-traffic services)**
   - Route 1–5% traffic to new version.
   - Evaluate latency, error rate, throughput, business metrics.
   - Auto-promote or auto-rollback based on gates.

4. **Feature flag cleanup**
   - Remove flags within 30 days of full rollout.
   - Maintain fewer than 20–30 active flags per service.

5. **Release communication**
   - Product Owner updates stakeholders.
   - Data Analyst confirms metric dashboards.

## Exit criteria

- Feature fully enabled or rolled back
- Flags cleaned up
- No unresolved SLO violations

## Frequency

Multiple times per day (elite DORA target).
