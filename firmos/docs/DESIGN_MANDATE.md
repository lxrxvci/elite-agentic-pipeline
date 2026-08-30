# FirmOS Design Mandate - "Elite 2026" Experience Bar

**Status:** Binding for all UX/UI agents (UX Researcher → UX Designer → UI Technologist) · **Source:** Client outcome data - the accounting firm was disappointed in the original Cruz build.

## 1. Why this mandate exists

The predecessor system (Yecny, built by Cruz) failed its users in three documented ways:

1. **Clunky** - heavy, dated UI; 6,000-line page components; interactions that fight the user.
2. **Extreme workflow friction** - the core loop (see what's due → do it → mark done) took too many clicks/decisions across too many screens; bidirectional sync surprises; no keyboard-first paths.
3. **Visually illiterate for a financial platform** - no meaningful color-coding system; staff couldn't glance at a screen and know what's on fire. For financial work, color IS information.

FirmOS exists to fix the firm, and the design must visibly embody that fix. A clunky UI would repeat Cruz's failure inside our own product.

## 2. The bar: what "elite 2026" means here

Reference class: Linear, Stripe Dashboard, Mercury, Ramp, Pile/Vercel dashboard aesthetics - calm, dense-but-scannable, instant-feeling.

### Non-negotiables
- **Color-coded status language everywhere.** Every status in the domain (overdue, due-soon, deferred, waiting-on-client, up-to-date, on-hold) maps to ONE semantic color token used identically across Workstation, client records, portal, dashboards. Pattern precedent: Denali's `badges.ts` - ~35 statuses collapsed into 6 semantic badge variants shared by every surface. oklch tokens only (perceptually uniform, dark-mode-ready).
- **Glanceable density.** Financial platforms live or die on tables/queues you can read at arm's length: tabular numerals, right-aligned money, zebra-free row hover, sticky headers, inline status dots + labels (never color-alone - WCAG).
- **Friction budget: ≤2 interactions to any daily action.** Complete/reopen a work item from the queue without leaving it (inline action or keyboard `E`); no modal mazes; no save buttons for field edits (optimistic autosave with undo toast).
- **Instant feel.** Optimistic UI mutations, skeleton states (never spinners), <100ms perceived interaction latency via RSC + server actions, URL-as-state so back button always works.
- **Keyboard-first workstation.** `/` search, `j/k` navigate queue, `E` complete, `⌘K` command palette. Mouse-optional daily loop.
- **Motion with restraint.** 150-250ms ease-out transitions only; respects `prefers-reduced-motion`.
- **Accessibility is gate-blocking, not aspirational.** Playwright a11y spec green required (pipeline already runs `test:a11y`).

### Explicitly banned (Cruz-build patterns)
- Full-page reloads for status changes · confirmation modals for reversible actions · >3-level nested navigation to reach daily actions · status conveyed by text alone in dense lists · spinners where skeletons belong · inconsistent badge colors per page.

## 3. Design-token direction (supersedes scaffold tokens.json)

The scaffold's generic Tailwind-palette tokens are placeholders. The design stage will replace them with an oklch semantic system:

| Semantic token | Meaning | Notes |
|---|---|---|
| `--status-overdue` | On fire | red family; always paired with icon |
| `--status-due-soon` | Due within window | amber family |
| `--status-on-track` | Up to date | green family |
| `--status-deferred` | Deferred-until active | violet family (distinct from "not due yet") |
| `--status-waiting-client` | Blocked on client input | cyan/blue family |
| `--status-on-hold` | Paused/archived | neutral gray |
| `--kind-bank-feed` / `--kind-reconciliation` / `--kind-report` / `--kind-task` | Work-TYPE identity (not state) | teal / violet / blue / neutral slate; fg+bg pairs, always paired with the kind icon |
| `--money-positive` / `--money-negative` / `--money-strong` | Financial figures | heroes use money-positive; dense-table totals use the AA-strong variant; negatives always keep the minus sign plus a text label |
| `--avatar-1..8-fg/bg` | Person identity | deterministic per-user hue (hash of user id) from a safe 8-hue oklch set |
Plus brand accent (bookkeeping-firm friendly teal-green region), light+dark themes, and a `data-status` attribute contract so badges render from one component everywhere. Color only ever means state (status tokens), type (kind tokens), identity (avatar hues), or money (money accents) - never decoration.

## 4. How compliance is verified (gates)

1. **Design stage:** UX Designer artifacts must map every MVP screen to the semantic token table above; review against this mandate before build.
2. **Build stage:** one `StatusBadge` component; ESLint rule/design review rejects ad-hoc hex colors outside tokens (`design-system/tokens.json` becomes the single source).
3. **QA stage:** Playwright a11y + visual smoke of Workstation at 1280px/1440px/390px; interaction-count audit: any daily-loop task exceeding the friction budget fails review.
4. **Client evidence:** the accounting firm that was disappointed in Cruz's build is design-partner #1 - their sign-off on the Workstation prototype is the experience acceptance test.
