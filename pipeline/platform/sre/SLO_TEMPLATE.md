# SLO Template

## Service

{{service_name}}

## SLIs & SLOs

| SLI | SLO | Measurement | Alert threshold |
|---|---|---|---|
| Availability | 99.9% over 30 days | Successful requests / total requests | 99.5% over 5 min |
| Latency (p95) | < 300ms over 30 days | Request duration histogram | > 500ms over 5 min |
| Error rate | < 0.1% over 30 days | 5xx / total responses | > 0.5% over 5 min |

## Error budget

- Period: 30 days.
- 50% exhausted → page on-call; prioritize reliability work.
- 100% exhausted → feature freeze until SLO is restored.

## Alerting

- Critical alerts page on-call.
- Warning alerts create tickets.
- All alerts link to runbooks.

## Review

- Review SLO attainment monthly.
- Recalibrate targets quarterly based on user impact and cost.
