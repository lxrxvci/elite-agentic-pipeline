# Workflow: Design & Build

## Purpose

Turn shaped, approved bets into validated designs and working software using OpenAPI-first, parallel FE/BE development.

## Trigger

- Shaped bet approved and RFC/ADR completed.

## Participants

- UX Designer (lead on design)
- UI Technologist
- Tech Lead
- Frontend Engineer
- Backend Engineer
- SDET
- Security Champion
- DesignOps (design system governance)

## Steps

1. **Design discovery**
   - UX Designer runs a compressed mini Double Diamond.
   - Review user flows and wireframes with the product trio.

2. **High-fidelity design**
   - UI Technologist applies design tokens and builds component specs.
   - DesignOps reviews new tokens and component proposals for system alignment.
   - Output: `design/HIFI_PROTOTYPES.md` and `design/DEV_HANDOFF.md`.

3. **Usability validation**
   - UX Researcher conducts usability tests (even lightweight).
   - Iterate based on findings.

4. **API contract**
   - Tech Lead finalizes `openapi.yaml`.
   - Frontend and Backend Engineers build in parallel.

5. **Implementation**
   - Backend Engineer builds domain logic, API, migrations.
   - Frontend Engineer builds UI using FSD and design system.
   - SDET defines test strategy and writes tests alongside code.
   - Security Champion reviews threats and secure defaults.

6. **Code review**
   - Small PRs (<400 lines).
   - First review within 1 hour.
   - Focus on knowledge transfer and design alignment.

7. **Merge to main**
   - All CI checks pass.
   - Feature flag wraps incomplete or risky code.

## Exit criteria

- Code merged to main behind feature flags if needed
- Diff coverage ≥80% on new/changed lines
- Security review complete
- OpenAPI contract implemented

## Frequency

Continuous, per backlog item.
