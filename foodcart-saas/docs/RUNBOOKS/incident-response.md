# Runbook: Incident Response

## Severity Levels

| Severity | Criteria | Response Time | Channel | Error-budget impact |
|---|---|---|---|---|
| SEV1 | Complete outage, data loss, security breach, AI assistant guardrail bypass | 15 min | #war-room | Full budget at risk |
| SEV2 | Major feature degraded, significant customer impact (checkout, publish, tenant isolation) | 1 hour | #incidents | > 25% budget |
| SEV3 | Minor degradation, workaround available | 4 hours | #incidents | < 25% budget |
| SEV4 | Cosmetic, no customer impact | Best effort | Backlog | None |

## Response Steps

1. **Detect** — Alert, support ticket, synthetic smoke test failure, or manual observation.
2. **Triage** — Confirm impact, assign severity, start an incident channel/thread, and page the on-call if SEV1/SEV2.
3. **Mitigate** — Stop the bleeding. Prefer rollback over forward fix. Use feature flags as kill switches where available.
4. **Resolve** — Verify service is healthy via `/health`, smoke tests, and SLO dashboards.
5. **Learn** — Schedule a blameless post-mortem within 48 hours for SEV1/SEV2.

## Communication Template

```
Incident: [brief title]
Severity: [SEV1/SEV2/SEV3/SEV4]
Impact: [what is broken and who is affected]
Started: [timestamp]
Status: [investigating / mitigating / resolved]
Next update: [timestamp]
```

## Key Checks

- Is the error budget being consumed? Check `docs/SLOs.md` and Grafana.
- Is a specific tenant affected? Verify tenant isolation logs.
- Did a deploy precede the incident? Check `gh run list --workflow=deploy.yml`.
- Is the AI assistant involved? Review guardrail decision logs.

## Rollback

If a recent deploy is suspect, follow `docs/RUNBOOKS/rollback.md` and
`docs/DEPLOYMENT.md`.

Quick commands:

```bash
# List recent deploys
gh run list --workflow=deploy.yml --limit 10

# Disable canary routing immediately
python scripts/update_edge_config_canary.py \
  --edge-config-id "$VERCEL_EDGE_CONFIG_ID" \
  --token "$VERCEL_TOKEN" \
  --percentage 0

# Roll back to previous production deployment
vercel rollback https://<previous-deployment-url> --token "$VERCEL_TOKEN" --yes

# Verify rollback
curl -fsS https://<production-backend>/health
curl -fsS https://<production-frontend>
```

## AI Assistant Guardrail Incidents

If the AI Website Assistant is suspected of allowing a prohibited operation or
cross-tenant access:

1. Disable the `ai-assistant` feature flag immediately.
2. Revoke the affected user's sessions if tenant isolation is in question.
3. Pull audit logs from `/api/v1/foodcart/ai/...` endpoints for the tenant.
4. Verify no `Revision` snapshots were modified outside the allowlist.
5. Escalate to AppSec Engineering and the Tech Lead.

## Tenant Isolation Incidents

If a tenant reports seeing another tenant's data:

1. Treat as SEV1 until proven otherwise.
2. Disable public site rendering for the affected slug via feature flag if needed.
3. Query access logs for the tenant's `site_id` and `tenant_id`.
4. Verify PostgreSQL RLS and repository filters are active.
5. Document all affected tenants and data classes in the post-mortem.

## Escalation

- On-call SRE → Engineering Lead → Product Lead
- For SEV1, page engineering and product immediately.
- For 50% error-budget burn, page on-call and prioritize reliability work.

## Post-Mortem

All SEV1 and SEV2 incidents require a blameless post-mortem within 48 hours.
Use the template in `docs/post-mortems/` and focus on:

- Timeline
- Root cause
- Detection gaps
- Mitigation effectiveness
- Action items with owners
