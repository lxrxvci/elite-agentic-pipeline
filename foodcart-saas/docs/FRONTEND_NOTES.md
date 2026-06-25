# Frontend Notes — Foodcart SaaS

> Engineering notes for the Cycle 1 Foodcart SaaS Next.js frontend.

## Stack

- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript strict mode
- **Styling:** Tailwind CSS 3.4 with custom Foodcart design tokens
- **State:**
  - Server state: TanStack Query v5
  - Client/UI state: Zustand (`features/auth/model/store.ts`)
- **Auth:** Clerk JWT passed via `Authorization: Bearer <token>` header
- **Testing:** Vitest + React Testing Library + Playwright

## Project structure

We follow Feature-Sliced Design (FSD):

```text
src/app/              # Next.js routes (admin, sites)
src/features/         # Feature slices
  onboarding/         # Onboarding wizard + slug check + onboard mutation
  site/               # Dashboard, editors, site/content queries
  assistant/          # AI propose/apply hooks
  public-site/        # Consumer site renderer, themes, hours util
src/shared/           # Shared code
  api/                # API client + Foodcart types
  ui/                 # Reusable UI components
src/widgets/          # Page-level widgets
  FoodcartLayout/     # Admin dashboard shell
```

## Routes

| Route | Purpose |
|---|---|
| `/admin/login` | Dev Clerk token sign-in |
| `/admin/onboarding` | 4-step onboarding wizard |
| `/admin/dashboard` | Site overview + publish toggle |
| `/admin/dashboard/business` | Hero / story / contact editor |
| `/admin/dashboard/hours` | Location hours editor |
| `/admin/dashboard/links` | Social & order link editor |
| `/admin/dashboard/appearance` | Template switcher |
| `/sites/[slug]` | Public consumer site renderer |

## API client

`src/shared/api/client.ts`:

- Reads `NEXT_PUBLIC_API_URL` (default `http://localhost:8000/api/v1`).
- Injects `Authorization: Bearer <token>` from the auth store.
- Exposes `setClerkToken` for debugging/test flows.

## Design tokens

`design-system/tokens.json` is mapped in `tailwind.config.js`:

- Global colors: `fc-neutral-*`, `fc-cobalt-*`, template colors (`banhmi-*`, `real-*`, `misa-*`).
- Semantic shortcuts: `fc-interactive`, `fc-text-primary`, `fc-surface`, etc.
- Typography: `font-display` (Rubik), `font-body` (Inter).
- Custom utilities: `shadow-card`, `shadow-elevated`, `text-display-xl`, `animate-float`, `animate-marquee`.

## Components

### Shared UI (`src/shared/ui/`)

| Component | Notes |
|---|---|
| `Button` | Variants: primary, secondary, outline, ghost, danger |
| `Input` / `Field` / `Label` | Accessible form primitives |
| `Card` | White rounded panel with shadow |
| `TemplateSelector` | Radio-group template picker |
| `HoursGrid` | Read-only weekly hours table |
| `LocationCard` | Address, phone, live status badge, hours |
| `SocialLinks` / `OrderLinks` | Accessible external link lists |
| `PreviewFrame` | Mobile/desktop iframe preview |
| `AIAssistantPanel` | Chat + diff preview + approve/reject |
| `Switch` | Accessible toggle |

### Public site sections (`src/features/public-site/ui/`)

Theme-aware section components driven by content blocks:
`HeroSection`, `StorySection`, `MenuSection`, `LocationsSection`, `OrderSection`, `CateringSection`, `FooterSection`, `PublicSitePage`.

## Hours & open status

`src/features/public-site/lib/hours.ts` computes a live open/closed badge from weekly hours and a timezone. It is used by `PublicSitePage` and `LocationCard`.

## AI Assistant

The dashboard shells an `AIAssistantPanel`:

1. Owner types a natural-language request.
2. Frontend POSTs to `/sites/{id}/ai/propose`.
3. Backend returns `in_scope`, `summary`, and `operations`.
4. If out-of-scope, a guardrail alert is shown.
5. If in-scope, a diff preview is rendered.
6. Owner approves → POST to `/sites/{id}/ai/apply`.
7. Content refetches and a revision is created.

## Testing

### Unit/component tests

Run with Vitest:

```bash
npm run test:ci
```

Coverage thresholds were ratcheted down temporarily while the Foodcart scaffold is built out. The goal is to raise them back to ≥80% on new code as more tests land.

### E2E tests

Playwright covers the core onboarding → publish → view site journey in `e2e/foodcart-journey.spec.ts`.

Run:

```bash
npm run test:e2e
```

## Known limitations / next steps

- Clerk integration is a dev token input for Cycle 1; replace with `@clerk/nextjs` `<SignIn />` before production.
- Image uploads are stubbed; real upload flow needs a backend storage contract.
- Multi-location sites render correctly but the admin editor only edits the first location in this cycle.
- The AI assistant diff preview is a simplified JSON-pointer view; a structured block-level diff renderer is planned.
- Template thumbnails are SVG placeholders; replace with real previews.

## Performance

- Public site sections are client-rendered in this Cycle 1 scaffold.
- Hero text is rendered server-side where possible.
- Animations respect `prefers-reduced-motion` via Tailwind defaults.
