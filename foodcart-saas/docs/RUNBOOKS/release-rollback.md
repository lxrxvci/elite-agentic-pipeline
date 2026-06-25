# Runbook: Release Rollback

## Purpose

Roll back a Foodcart SaaS release that is causing elevated errors, latency,
SLO breaches, functional regressions, or security issues.

## When to use this runbook

- `deploy.yml` `rollback-on-failure` job did not trigger or did not complete.
- A canary release is failing SLOs and needs to be pulled immediately.
- A fully promoted release needs to be reverted to the previous production
  deployment.
- A feature-flag flip did not fully mitigate the issue.

## Prerequisites

- GitHub CLI (`gh`) authenticated.
- Vercel CLI authenticated or a `VERCEL_TOKEN` available.
- `VERCEL_EDGE_CONFIG_ID`, `VERCEL_ORG_ID`, and `PROMETHEUS_URL` environment
  variables set.

## Step-by-step rollback

### 1. Identify the bad release

```bash
gh run list --workflow=deploy.yml --limit 10
```

Note the failing or suspect run. Open the run and confirm which job failed
(`enable-canary`, `canary-analysis`, `slo-check`, `promote-canary`, or
`smoke-production`).

### 2. Stop the bleeding

Disable canary routing immediately so no traffic reaches the canary backend:

```bash
python scripts/set_canary.py \
  --edge-config-id "$VERCEL_EDGE_CONFIG_ID" \
  --vercel-token "$VERCEL_TOKEN" \
  --team-id "$VERCEL_ORG_ID" \
  --percentage 0
```

If the issue is feature-flag related, disable the flag in Unleash before
rolling back code.

### 3. Check SLO impact

```bash
python scripts/slo_check.py \
  --prometheus-url "$PROMETHEUS_URL" \
  --window 5m \
  --availability-threshold 0.999 \
  --error-rate-threshold 0.001 \
  --latency-p95-threshold 0.3 \
  --ai-latency-p95-threshold 5.0 \
  --saturation-threshold 0.8 \
  --recommend
```

If the output shows `ROLLBACK`, continue. If metrics have already recovered
because canary routing was disabled, still verify the code state.

### 4. Find the previous production deployments

```bash
team_q=""
[ -n "$VERCEL_ORG_ID" ] && team_q="?teamId=${VERCEL_ORG_ID}"

previous_backend=$(curl -sS "https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID_BACKEND}&target=production&limit=2&state=READY${team_q}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  | python3 -c "import sys, json; ds=json.load(sys.stdin).get('deployments', []); print(ds[1]['url'] if len(ds) > 1 else '')")

previous_frontend=$(curl -sS "https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID_FRONTEND}&target=production&limit=2&state=READY${team_q}" \
  -H "Authorization: Bearer ${VERCEL_TOKEN}" \
  | python3 -c "import sys, json; ds=json.load(sys.stdin).get('deployments', []); print(ds[1]['url'] if len(ds) > 1 else '')")

echo "Previous backend: $previous_backend"
echo "Previous frontend: $previous_frontend"
```

### 5. Roll back the backend

```bash
vercel rollback "https://${previous_backend}" --token "$VERCEL_TOKEN" --yes
```

If the previous deployment URL is unavailable, use the Vercel dashboard to
select the previous production deployment and click **Rollback**.

### 6. Roll back the frontend

```bash
vercel rollback "https://${previous_frontend}" --token "$VERCEL_TOKEN" --yes
```

### 7. Verify the rollback

```bash
curl -fsS --retry 10 --retry-delay 5 "${PRODUCTION_BACKEND_URL}/health"
curl -fsS --retry 10 --retry-delay 5 "${PRODUCTION_FRONTEND_URL}"
```

Run a quick canary analysis against production to confirm the previous version
is healthy:

```bash
python scripts/canary_analysis.py \
  --url "${PRODUCTION_BACKEND_URL}/health" \
  --requests 50 \
  --concurrency 5 \
  --max-error-rate 0.001 \
  --max-latency-p95 0.3 \
  --max-latency-p99 1.0 \
  --recommend
```

### 8. Re-check SLOs

```bash
python scripts/slo_check.py \
  --prometheus-url "$PROMETHEUS_URL" \
  --window 5m \
  --availability-threshold 0.999 \
  --error-rate-threshold 0.001 \
  --latency-p95-threshold 0.3 \
  --recommend
```

### 9. Communicate

Post in `#incidents`:

```
Release rolled back
Bad release: <workflow run URL>
Previous backend: https://<previous-backend>
Previous frontend: https://<previous-frontend>
Current status: <healthy / monitoring>
Next step: <investigate root cause / schedule forward fix>
```

### 10. Follow up

- For SEV1/SEV2 incidents, schedule a blameless post-mortem within 48 hours.
- Update `docs/post-mortems/` with the timeline and action items.
- If a migration caused data corruption, restore from backup before attempting
  a forward fix. Document any data remediation.

## Automation reference

The `deploy.yml` workflow runs the same logic automatically:

- `enable-canary` uses `scripts/set_canary.py` to shift 5% of traffic and verify
  health.
- `canary-analysis` and `slo-check` gate promotion.
- `rollback-on-failure` disables canary and calls `vercel rollback` when any
  production-facing job fails.

If automated rollback fails, use the manual steps above.
