# DesignOps Playbook

## Tooling

### Design tokens

- Source of truth: `design-system/tokens.json`
- Distribution: Tailwind config at `src/frontend/tailwind.config.js` (current), with a planned migration to a token pipeline (Style Dictionary or Token Studio) in a future cycle.
- Naming convention: `elite-{token-path}` in CSS/Tailwind (e.g. `elite-text-primary`).

### Design tools

- **Figma**: primary design and prototyping tool.
  - Use shared libraries linked to `design-system/tokens.json` values.
  - Components must match the spec in `design-system/components/`.
- **Storybook** (planned): component playground and documentation.
- **axe DevTools**: designer and engineer accessibility smoke tests.

### Code quality

- ESLint + Prettier for code style.
- Vitest + Testing Library for component unit tests.
- Playwright + `@axe-core/playwright` for accessibility E2E tests.
- Lighthouse CI for performance and accessibility budgets.

## Asset management

### Images and icons

- Generated site images are tenant-owned assets stored in S3 (or equivalent) with tenant-scoped paths.
- Provide fallbacks for missing logos/hero images.
- Use `lucide-react` for UI icons; custom icons are reviewed by DesignOps.
- All images require `alt` text strategy: decorative images use `alt=""`; content images describe the subject.

### Fonts

- Admin dashboard: `Inter` only.
- Generated sites: `Inter` for body; `Rubik` for display headlines on bold/branded templates (e.g. Banh Mi Fusion).
- Load fonts with `font-display: swap` to prevent invisible text.

## Handoff process

```
UX Designer
    ↓ user flows, wireframes, research findings
UI Technologist
    ↓ tokens, component specs, Figma prototypes
DesignOps review
    ↓ token/component governance sign-off
Frontend Engineer
    ↓ implementation in src/frontend/src/shared/ui or squad layer
SDET
    ↓ accessibility and component tests
Code review → merge
```

### Handoff checklist

- [ ] Design tokens exist or are proposed in `design-system/tokens.json`.
- [ ] Component spec exists in `design-system/components/`.
- [ ] Figma file links to the relevant spec.
- [ ] Accessibility notes are included (keyboard order, focus, ARIA, motion).
- [ ] Responsive breakpoints and mobile-first behavior are specified.
- [ ] Edge cases (empty states, loading, error) are designed.

## Accessibility compliance tracking

| Checkpoint | Tool / method | Frequency | Owner |
|---|---|---|---|
| Automated WCAG 2.1 AA | `@axe-core/playwright` | Every PR | SDET |
| Lighthouse accessibility | Lighthouse CI | Every PR | Frontend Engineer |
| Keyboard navigation | Manual checklist | New core/shared component | UI Technologist |
| Screen-reader review | VoiceOver / NVDA | New core/shared component | UX Designer |
| Color contrast | Figma contrast plugin + dev tools | Token/component change | DesignOps |
| Reduced-motion review | CSS `prefers-reduced-motion` | New animation | UI Technologist |

### Accessibility checklist for every component

- [ ] Color is not the sole means of conveying information.
- [ ] Focus indicator is visible and high-contrast.
- [ ] Keyboard operability documented.
- [ ] ARIA roles and properties match the pattern.
- [ ] Screen-reader labels are descriptive and unique.
- [ ] Motion respects `prefers-reduced-motion`.

## Onboarding

New designers and frontend engineers complete:

1. Read `design-system/README.md` and this playbook.
2. Review `docs/DESIGN_SYSTEM_GOVERNANCE.md`.
3. Walk through existing components in `design-system/components/` and their implementations.
4. Complete a token/component change exercise with DesignOps review.

## Community of practice

- **Design system office hours**: weekly 30-minute session for questions and proposals.
- **Component show-and-tell**: bi-weekly review of new or updated components.
- **Accessibility guild**: monthly cross-squad review of audit findings and patterns.

## Metrics

Track monthly and report in the design-system section of the cycle retrospective:

- Token coverage (% of raw Tailwind values sourced from `tokens.json`).
- Component reuse count (how many squads use each shared component).
- Accessibility audit pass rate.
- Time from proposal to merged component (change cycle time).
- Design-system-related bugs and regressions.
