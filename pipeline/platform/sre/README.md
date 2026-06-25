# SRE Platform Templates

Reusable observability, reliability, and chaos-engineering templates for Foodcart
SaaS squads. These templates are maintained by the SRE Platform team; squad
DevOps/SRE agents copy and adapt them into the squad observability stack.

## Contents

| Path | Purpose |
|---|---|
| `prometheus/recording-alerting-rules.yml` | Recording rules + alert rules for availability, latency, error rate, AI assistant latency, frontend LCP, saturation, and error-budget burn. Every alert links to a runbook. |
| `grafana/dashboard.json` | Grafana dashboard JSON covering the 6–8 key SLO/golden-signal metrics. |
| `opentelemetry/collector-config.yml` | OpenTelemetry Collector snippet for traces, metrics, and logs from Next.js, FastAPI, PostgreSQL, and the AI assistant. |

## Rules of engagement

1. **Alert quality:** Every alert must link to a runbook (`annotations.runbook_url`).
2. **Error budgets:** Error-budget alerts are binding. 50% burn pages on-call;
   100% burn freezes feature work until the budget resets or SLO is restored.
3. **Toil cap:** Operational toil must not exceed 50% of SRE time. Prefer
   automation, self-healing, and auto-rollbacks.
4. **Tenant safety:** All telemetry processors must redact PII and tag signals
   with `tenant.id` only where necessary for debugging. Never export payment
   tokens or credentials.

## Adapting for your squad

1. Replace the `foodcart_*` metric prefix with your instrumentation prefix.
2. Update `runbook_url` and `dashboard_url` annotations to your wiki/Grafana.
3. Adjust threshold durations based on request volume.
4. Validate rules with `promtool check rules recording-alerting-rules.yml`.
5. Import the dashboard JSON into Grafana and verify panel queries.
