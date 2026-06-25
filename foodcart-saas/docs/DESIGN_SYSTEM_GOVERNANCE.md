# Design System Governance

## Purpose

This document defines how the Foodcart SaaS design system is governed, evolved, and adopted across squads.

## Governance model: hybrid core + domain

- **Core team (DesignOps)** owns cross-cutting primitives, token architecture, accessibility standards, and governance documentation.
- **Domain teams** own squad-specific components and patterns built on top of core tokens and primitives.
- **Design council** (DesignOps + Tech Lead + UX Designer + UI Technologist + Security Champion + SDET) reviews proposals that introduce new tokens, components, or breaking changes.

## Three-tier token architecture

All design tokens MUST follow the hierarchy: **global → semantic → component**.

1. **Global tokens** are raw values. They never encode intent.
2. **Semantic tokens** map global values to meaning (text-primary, surface-hover, etc.).
3. **Component tokens** reference semantic tokens for a specific component's properties.

A component token MUST NOT reference a global token directly unless the value is truly invariant (e.g. a fully rounded pill radius of `9999px`).

## Component classification

| Class | Owner | Examples | Lifecycle |
|---|---|---|---|
| Core primitive | DesignOps | Button, Input, Modal, StatusBadge | RFC → ADR → implementation |
| Shared layout | DesignOps | SiteSection, HeroBlock | Proposal → council review |
| Domain component | Squad | MenuCard, LocationCard, OrderButton | Local review; promote to shared when reused |
| Third-party | Squad / platform | Clerk components, map embeds | Wrap, do not fork |

## Contribution process

1. **Need identification** — squad opens a proposal or design-system backlog item.
2. **Token audit** — contributor checks whether existing tokens satisfy the need.
3. **Proposal** — for new tokens or core components, write a short RFC-like proposal including:
   - Problem statement
   - Proposed tokens / component API
   - Accessibility considerations
   - Usage examples
   - Alternatives considered
4. **DesignOps review** — DesignOps audits the proposal against the token hierarchy, accessibility standards, and system duplication.
5. **Council review** — required for new global/semantic tokens, new core components, or breaking changes.
6. **Implementation** — UI Technologist + Frontend Engineer implement; SDET adds tests.
7. **Documentation** — update `design-system/`, Storybook, and this governance doc if rules change.
8. **Release** — version bump and changelog entry.

## Review checklist

### Tokens

- [ ] Three-tier hierarchy respected (global → semantic → component).
- [ ] No raw hex values in semantic or component tiers (except noted invariants).
- [ ] New color tokens meet WCAG 2.1 AA contrast against their expected backgrounds.
- [ ] Animation tokens include `prefers-reduced-motion` guidance in component specs.

### Components

- [ ] Accessibility spec is present: keyboard behavior, focus management, ARIA roles, screen-reader notes.
- [ ] Props/API is minimal and typed.
- [ ] Usage examples cover primary, edge, and misuse cases.
- [ ] Component does not duplicate an existing core or shared component.
- [ ] Responsive behavior is specified for mobile-first generated sites.

### Process

- [ ] Proposal reviewed by DesignOps.
- [ ] Breaking changes approved by design council.
- [ ] Documentation and tests updated.
- [ ] Changelog entry added.

## Roles and responsibilities

| Role | Responsibility |
|---|---|
| DesignOps | Token architecture, core primitives, governance docs, backlog prioritization, accessibility compliance tracking |
| UX Designer | User flows, wireframes, usability validation |
| UI Technologist | Component specs, design-token application, design-tooling integration |
| Frontend Engineer | Implementation in FSD `shared/ui`, tests, performance |
| SDET | Accessibility tests, visual regression strategy, component contract tests |
| Security Champion | Reviews components that handle user content, external links, or tenant-scoped rendering |
| Tech Lead | Technical feasibility, build-system integration, Tailwind/token pipeline |

## Backlog and roadmap

The design system is treated as a product:

- **Backlog** is a section in `BACKLOG.md` labeled `design-system/`.
- **Roadmap** aligns with product `ROADMAP.md` and is refreshed per cycle.
- **Metrics** tracked: component adoption rate, token usage coverage, accessibility audit pass rate, design-system change cycle time.

## Cycle 1 priorities

1. Stabilize token hierarchy and migrate Tailwind config to consume `tokens.json`.
2. Ship core primitives (Button, Input, Modal, StatusBadge) with full accessibility specs.
3. Ship domain starter components for generated restaurant sites (MenuCard, LocationCard, OrderButton, SocialLink, HeroBlock, SiteSection).
4. Establish accessibility baseline: automated axe checks in CI, manual keyboard audit.

## Compliance and exceptions

- All generated restaurant sites must pass WCAG 2.1 AA automated checks.
- New core or shared components require a manual keyboard and screen-reader review before merge.
- Exceptions are logged in `docs/STAKEHOLDER_DECISION_LOG.md` with risk accepted by Product Owner and Security Champion.
