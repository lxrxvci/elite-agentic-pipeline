# SRE Platform Templates — Foodcart SaaS

This directory contains reusable observability, reliability, and incident-response
templates maintained by the SRE Platform team. Squad-specific configurations in
`foodcart-saas/observability/` and `foodcart-saas/docs/RUNBOOKS/` are derived from
these templates and owned by DevOps/SRE.

## Templates

| Template | Purpose | Owner |
|---|---|---|
| [`weekly-review-checklist.md`](weekly-review-checklist.md) | Recurring checklist for the Observe & Improve weekly review | SRE Platform |
| [`alert-tuning-guide.md`](alert-tuning-guide.md) | Guidance for tuning alert thresholds, severity, and runbook links | SRE Platform |
| [`post-mortem-template.md`](post-mortem-template.md) | Blameless post-mortem template for incidents and game-day findings | SRE Platform |
| [`prometheus/recording-alerting-rules.yml`](prometheus/recording-alerting-rules.yml) | Reusable Prometheus recording and alerting rules | SRE Platform |
| [`grafana/dashboard.json`](grafana/dashboard.json) | Reusable Grafana dashboard JSON for golden signals | SRE Platform |
| [`opentelemetry/collector-config.yml`](opentelemetry/collector-config.yml) | OpenTelemetry Collector configuration snippet | SRE Platform |

## Rules

1. **Every alert must link to a runbook.** No alert is deployed without a
   `runbook_url` annotation.
2. **Error budgets are binding.** A 100% monthly budget burn triggers a feature
   freeze until the SLO is restored or the budget resets.
3. **Operational toil is capped at 50% of SRE time.** Templates should drive
   automation and self-service, not manual work.
4. **Post-mortems are blameless.** Focus on system, process, and tooling
   improvements, not individuals.

## Updating these templates

When SRE Platform changes a template, file a PR and notify the DevOps/SRE Agent
to update squad-specific configs. Major changes (new SLO category, new severity
model) require review by Tech Lead and Product Owner.
