# SLSA Roadmap — Foodcart SaaS

| Attribute | Value |
|---|---|
| Product | Foodcart SaaS |
| Author | AppSec Engineering |
| Date | 2026-06-24 |
| Current SLSA level | 1 (scripted build, partial provenance) |
| Target SLSA level | 3 |

## Overview

Foodcart SaaS uses GitHub Actions for CI/CD, Vercel for frontend/backend deployment, and Terraform for AWS infrastructure. This roadmap defines the steps to raise our supply-chain assurance from **SLSA Level 1** to **SLSA Level 3**, aligned with the controls in `docs/THREAT_MODEL.md` (T013 supply-chain compromise).

## Current state (SLSA Level 1)

| Requirement | Status | Evidence |
|---|---|---|
| Scripted build | ✅ | GitHub Actions workflows in `.github/workflows/`. |
| Provenance exists | ⚠️ Partial | GitHub Actions emits run metadata; no signed attestation yet. |
| Version control | ✅ | Source lives in GitHub; `require_signed_commits` is enabled in `infra/main.tf`. |
| Pinned dependencies | ⚠️ Partial | `package-lock.json` committed; `requirements.txt` generated but hashes not enforced. |
| Isolated build | ❌ | Builds run on shared GitHub-hosted runners. |
| Reproducible build | ❌ | No reproducibility verification. |
| Signed artifacts | ❌ | Vercel deploys are not signed by us; no container images. |

## Target state (SLSA Level 3)

Level 3 requires:

- Builds run on an isolated, hardened runner (no direct maintainer access).
- Provenance is generated automatically and trusted (signed).
- Dependencies are pinned and verified.
- Builds are reproducible or at least verifiable.

## Roadmap

### Phase 1 — Reach SLSA Level 2 (Cycle 2)

| Step | Action | Owner | Acceptance criteria |
|---|---|---|---|
| 1.1 | Pin Python dependencies with hashes | Security Champion | `requirements.txt` generated with `--generate-hashes`; CI installs with `--require-hashes`. |
| 1.2 | Pin GitHub Actions to commit SHA | AppSec Engineering | All `uses:` references in workflows use a pinned commit SHA with a version comment. |
| 1.3 | Enable GitHub artifact attestations | DevOps/SRE | `deploy.yml` already has `attestations: write`; add `actions/attest-build-provenance` to build/deploy jobs. |
| 1.4 | Store provenance with releases | DevOps/SRE | Every production deployment creates/releases a signed provenance attestation. |
| 1.5 | Document build environment | AppSec Engineering | `docs/SLSA_ROADMAP.md` updated with runner image and tool versions. |

### Phase 2 — Reach SLSA Level 3 (Cycle 3)

| Step | Action | Owner | Acceptance criteria |
|---|---|---|---|
| 2.1 | Hardened / isolated runner | DevOps/SRE | Use GitHub-hosted larger runners or self-hosted runners with ephemeral VMs and no persistent secrets. |
| 2.2 | Reproducible build verification | AppSec Engineering | Build the backend/frontend twice from the same commit and compare hashes; document non-determinism. |
| 2.3 | Sign deployment artifacts with Sigstore/cosign | DevOps/SRE | Sign Vercel build outputs or container images with cosign/Sigstore and publish signatures. |
| 2.4 | Verify provenance before production promotion | DevOps/SRE | Promotion job fails if attestation is missing or signer identity does not match the release service account. |
| 2.5 | Dependency update automation | Security Champion | Dependabot or Renovate opens PRs for outdated pinned dependencies with SCA pre-check. |

## Signing patterns

### GitHub artifact attestations (recommended for Cycle 2)

```yaml
- uses: actions/attest-build-provenance@v1
  with:
    subject-path: |
      ${{ inputs.project-dir }}/src/backend
      ${{ inputs.project-dir }}/src/frontend
```

This produces a Sigstore-signed attestation linked to the GitHub repository and workflow identity. No long-lived signing keys are required.

### Cosign for container images (if we introduce containers)

```bash
cosign sign --yes "ghcr.io/${{ github.repository }}/backend:${{ github.sha }}"
```

Use keyless signing with the GitHub Actions OIDC identity.

## Verification

Consumers and downstream jobs should verify provenance before deployment:

```bash
gh attestation verify --repo owner/repo <artifact>
```

Production promotion in `deploy.yml` should be extended to fail if the attestation for the current commit is missing or the signer identity is unexpected.

## References

- SLSA Specification: https://slsa.dev/spec/v1.0/
- GitHub artifact attestations: https://docs.github.com/en/actions/security-guides/using-artifact-attestations-to-establish-provenance-for-builds
- Sigstore/cosign keyless signing: https://docs.sigstore.dev/cosign/
- `docs/THREAT_MODEL.md` T013
- `docs/APPSEC_PLAYBOOK.md`
