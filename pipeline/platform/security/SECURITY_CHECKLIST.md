# Security Checklist

Use this checklist before shipping any shaped bet to production.

## Design

- [ ] Threat model updated for new feature.
- [ ] Data classification documented (public, internal, confidential, restricted).
- [ ] Authentication and authorization flows reviewed.

## Implementation

- [ ] All inputs validated with Pydantic schemas.
- [ ] SQL injection prevented via ORM parameterization.
- [ ] XSS prevented by output encoding and CSP.
- [ ] Secrets are not logged or returned in error messages.
- [ ] Rate limiting applied to auth and mutation endpoints.

## CI/CD

- [ ] SAST scan passes (Bandit, Semgrep).
- [ ] Dependency scan passes (Trivy, Dependabot).
- [ ] Secret scan passes (TruffleHog).
- [ ] Container image signed before deployment.

## Deployment

- [ ] Production secrets rotated and stored in Secrets Manager.
- [ ] Dev-only endpoints disabled in production.
- [ ] Security headers (CSP, HSTS, etc.) active.

## Post-deploy

- [ ] Access logs reviewed for anomalies.
- [ ] Security metrics monitored for 7 days.
