# Chaos Engineering Runbook

## Purpose
Validate resilience of the Elite platform by injecting controlled failures and observing recovery behavior.

## Scope
- Backend service availability (Fly.io)
- Database failover / slow queries
- Dependency degradation
- Correlation ID propagation under load

## Experiments

### 1. Instance restart
**Hypothesis:** Restarting one backend machine causes zero failed user requests because Fly.io routes to healthy machines.

**Procedure:**
```bash
fly machine list --app elite-backend
fly machine restart <machine-id> --app elite-backend
```
**Verify:** Health endpoint returns 200 within 30s; error rate stays below SLO.

### 2. Simulated dependency failure
**Hypothesis:** If the database becomes slow, the backend degrades gracefully (timeouts, not cascading failures).

**Procedure:**
- Use `pgbench` or database proxy latency injection to add 2s latency.
- Run canary analysis script.

**Verify:** P99 latency rises but 5xx rate remains under 1%.

### 3. Load spike
**Hypothesis:** The backend sustains 10x baseline RPS without breaching latency SLO.

**Procedure:**
```bash
k6 run tests/load/spike.js
```
**Verify:** Grafana dashboard shows CPU < 80%, P99 latency < 500ms.

## Abort criteria
- Error rate exceeds 5% for > 2 minutes.
- Any PII leak or data corruption observed.
- Manual stop from incident commander.

## Post-experiment
1. Capture metrics and logs from Grafana/Loki.
2. Update `METRICS.md` or SLOs if gaps found.
3. File improvement tickets and link to this runbook.
