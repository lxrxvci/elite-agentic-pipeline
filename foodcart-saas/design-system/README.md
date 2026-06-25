# Foodcart SaaS Design System

The Foodcart SaaS design system is a shared source of truth for visual language, interaction patterns, and accessibility standards across the admin dashboard and generated restaurant sites.

## Token architecture

Tokens are organized in three tiers, defined in `tokens.json`:

| Tier | Purpose | Example |
|---|---|---|
| **Global** | Raw, context-agnostic values: colors, spacing, type scale, radii, shadows, animation, breakpoints. | `global.color.blue-600`, `global.spacing.04` |
| **Semantic** | Meaningful abstractions that describe intent: text colors, surface treatments, typography roles, elevation, focus. | `semantic.color.text-primary`, `semantic.typography.heading-1` |
| **Component** | Component-specific mappings that consume semantic and global tokens. | `component.button-primary.background`, `component.menu-card.radius` |

All references use the `{tier.category.token}` notation. A future token pipeline (e.g. Style Dictionary) can resolve these into CSS custom properties, Tailwind config values, or Figma variables.

## Component organization

Components are classified by ownership and reuse potential:

- **Core primitives** — owned by DesignOps; used everywhere.
  - `Button`, `Input`, `Modal`, `StatusBadge`
- **Shared layout** — owned by DesignOps; page-level wrappers.
  - `SiteSection`, `HeroBlock`
- **Domain components** — owned by squads; specific to restaurant sites.
  - `MenuCard`, `LocationCard`, `OrderButton`, `SocialLink`

Each component spec lives in `components/` as Markdown and includes:

1. Purpose
2. Anatomy
3. Props / API
4. Tokens consumed
5. Accessibility spec
6. Usage examples

## Usage in the frontend

The project currently maps design tokens into Tailwind via `src/frontend/tailwind.config.js` using the `elite-*` namespace. When tokens are updated:

1. Edit `design-system/tokens.json`.
2. Update `src/frontend/tailwind.config.js` to reflect new or changed values.
3. Update component implementations and tests in `src/frontend/src/shared/ui/`.
4. Run `npm run test:ci` and `npm run test:a11y`.

## Status

This is the Cycle 1 starter set. The backlog and roadmap are maintained in `docs/DESIGN_SYSTEM_GOVERNANCE.md`.

## Contributing

See `docs/DESIGN_OPS_PLAYBOOK.md` for the contribution, review, and handoff process.
