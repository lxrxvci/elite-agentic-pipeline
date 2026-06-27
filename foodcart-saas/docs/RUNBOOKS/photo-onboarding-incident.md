# Runbook: Photo Onboarding Incident

This runbook covers failures in the photo-driven onboarding flow: image upload,
vision extraction, Google Places enrichment, and the photo upload UI.

## Common Symptoms

- Users report the photo step is stuck or fails to upload.
- Alert `HighUploadFailureRate` fires.
- Alert `HighPhotoEnrichmentFailureRate` fires.
- Alert `VisionLatencyHigh` or `PlacesLatencyHigh` fires.
- Onboarding completion rate drops for tenants with `photo-onboarding-v1` enabled.
- Error boundary `PhotoUploadStep` events spike in frontend telemetry.

## Immediate Triage

1. Check feature flag state in LaunchDarkly / your flag service:
   - Flag: `photo-onboarding-v1`
   - If the failure is isolated to photo flow, disable the flag as a kill switch.
2. Open the **Photo Onboarding** Grafana dashboard.
3. Correlate with recent deploys:
   ```bash
   gh run list --workflow=deploy.yml --limit 10
   ```
4. Determine whether the issue is **upload**, **vision/Places**, or **UI/frontend**.

## Per-Component Mitigation

### Upload failures (`elite_uploads_total{status="failed"}`)

- Verify object-storage credentials (`STORAGE_ENDPOINT`, `STORAGE_ACCESS_KEY_ID`,
  `STORAGE_SECRET_ACCESS_KEY`, `STORAGE_BUCKET_NAME`) in the backend environment.
- Check R2/S3 bucket health and CORS settings (allowed origin must include the
  frontend URL and `POST` method).
- Verify the presigned URL TTL (`UPLOAD_URL_EXPIRATION_SECONDS`) is not so short
  that uploads expire before the frontend uses them.
- Check network logs for 403/400 responses from the storage endpoint.

### Vision extraction failures (`elite_photo_enrichment_total{status="failed"}`)

- Verify `GEMINI_API_KEY` is set and not rate-limited.
- Inspect backend logs for `photo_enrichment_failed`; error context is included
  in the structured log.
- Check `elite_photo_vision_duration_seconds` p95; if latency is high, Gemini
  may be throttling. Consider temporarily raising `VISION_TIMEOUT_SECONDS` or
  falling back to manual onboarding.

### Places enrichment failures

- Verify Google Places API (New) key and quota.
- Inspect backend logs for `places.search_places` or `places.get_place_details`
  errors.
- The onboarding flow intentionally degrades to manual entry when enrichment
  fails; verify degraded completions are acceptable.

### Frontend telemetry ingestion

The frontend posts telemetry events to `POST /api/v1/telemetry`. The endpoint
returns 204, logs a structured `telemetry_event_received` entry, and increments
`elite_telemetry_events_total`. If telemetry volume is unexpectedly high or
events are not appearing in dashboards, verify the endpoint is reachable from
the frontend origin and that the metrics provider is initialized.

## Rollback

If the issue started after a deploy and a forward fix is not immediate:

1. Disable the `photo-onboarding-v1` feature flag.
2. Follow `docs/RUNBOOKS/release-rollback.md` if broader deploy rollback is
   needed.
3. Verify `/health` and run smoke tests against staging and production.

## Verification

After mitigation, confirm:

- `elite_uploads_total{status="success"}` rate recovers.
- `elite_photo_enrichment_total{status="success"}` rate is >= 95%.
- `elite_photo_vision_duration_seconds` p95 < 5s.
- `elite_onboarding_completions_total` returns to baseline.
- Frontend telemetry error events subside.

## Escalation

- Upload/storage outage affecting all new tenants → SEV1.
- Vision/Places degradation with manual fallback available → SEV2/SEV3.
- Cosmetic UI issue → SEV4.

Follow `docs/RUNBOOKS/incident-response.md` for severity, paging, and
post-mortem requirements.
