# Design Direction: "FreshBooks-ification" of firmOS

Source: 4 modern FreshBooks UI references (invoices list, dashboard desktop+mobile, client record, dashboard alt) + Jason's asks from the 2026-09-22 call (cards with definitive start/stop, reduced cognitive fatigue, stay-on-one-screen, dopamine on completion) + Matthew's anchor: FreshBooks color & feel.

This spec translates the references onto our existing oklch token architecture. **Keep what is ours and better** (6-status dot+label contract, keyboard loop, optimistic undo, dark mode, reduced-motion). **Adopt what is theirs and better** (color confidence, hero numerals, card clarity, friendly empty states, green action language).

## 1. Signature elements from the references

| Element | FreshBooks pattern | firmOS translation |
|---|---|---|
| Sidebar | Deep/rich blue rail (~#0B5ED7→#0A4CA8 family), white icon+label items, active = darker navy pill, chevron expandables, company+role switcher at top | App sidebar becomes the blue brand rail. White text, active pill = darker blue. Keep our unread badges. Must remain legible in dark mode (rail can stay blue in both themes). |
| Primary action | Saturated **green** button top-right ("New Invoice", "Create New…" split-button w/ icon dropdown) | One green primary action per page, top-right. Workstation: green = "Complete" (E) affordance + quick-add. Split-button pattern for Create New (task/note/meeting) — our quick-add "Y" already is this; restyle green. |
| Hero stats | Huge blue numbers (28–34px, bold, tabular), small gray caption beneath ("total outstanding", "in draft") | Every money/count surface gets hero numerals. Workstation top: Overdue / Due Today / Upcoming / Waiting as 4 hero stats. Client record: outstanding, unbilled, hours. |
| Cards | White, 1px cool-gray border, ~8px radius, *subtle* shadow; status via **pastel footer band** (Sent=yellow, Paid=green, Draft=gray) or left edge tint | Work cards keep single-row density but become white cards on a cool-gray-50 canvas with a status-tinted footer band or 3px left edge. Hover: slight lift. Keep dot+label pairing (a11y contract) inside the band. |
| Segmented pills | Centered pill toggle ("From Me / To Me", "Overview / Relationship") | Bucket filter + day-of-week chips become segmented pill groups. |
| Money typography | Right-aligned, tabular, page-footer totals bar | Already have `tnum`; enforce everywhere money appears. |
| Charts | Green fill above zero / pink below (profit-loss), donuts with icon+label legends, stacked aging bars | Reports/profitability adopt green-positive/pink-negative fills; progression board keeps tokens but gains this positive/negative language. |
| Empty states | Dashed-border ghost card with big "+" ("New Invoice"); friendly italic copy ("Invoices are all paid") | Ghost "+ New" cards where creation makes sense; rewrite empty copy to be human and short. "Caught up" states stay celebratory. |
| Badges/chips | Pastel pill chips, dot optional | Keep our status tokens; chips get softer pastel fills with darker text (AA). |
| Trial/notice bar | Cream/yellow pill at top with icon | Pattern for our notification/attention strip (e.g. "3 clients waiting on you"). |
| Canvas | Very light cool gray/white; content max-width ~1200px centered; generous whitespace | Pages get a max-width container (kills the "stretched full-width" fatigue Jason hates) except true data-grids (progression board) which may go wide by exception. |

## 2. Token changes (globals.css)

Shift brand hue from teal (#007B7F) toward **FreshBooks blue #0075DD**, keeping the oklch architecture and AA contrast (the a11y gate is CI-blocking — white-on-primary and primary-on-white must stay ≥4.5:1; use a `-strong` variant for text-on-light).

- `brand` → FreshBooks blue family; `brand-strong` darkened for AA text use
- New `action` token: saturated FreshBooks green for the one-primary-action-per-page rule (distinct from status `on-track` green — action green is for *doing*, status green is for *done*)
- Status tokens stay semantically identical (overdue/due-soon/on-track/deferred/waiting/on-hold) but retint toward the reference pastels: due-soon yellow ≈ invoice "Sent" band, on-track green ≈ "Paid", draft-gray for neutral
- Elevation scale: `shadow-card` (subtle, default cards), `shadow-pop` (dropdowns/overlays), `shadow-modal`
- Sidebar tokens: `rail` blue gradient/solid, `rail-active` darker pill, `rail-text` white
- Keep work-kind identity colors (bank-feed/recon/report/task) — they are ours and good; harmonize saturation with the new palette
- Light theme first (the gate scans light); dark theme keeps tokens consistent, rail may stay blue

## 3. Typography

Keep Inter (UI/data) + Plus Jakarta Sans (display). Changes: hero numerals = Plus Jakarta Sans bold, `tnum`, 28–34px; captions = 12–13px gray; base font on dense pages unchanged (density is a feature for operators — the *clarity*, not the size, was Jason's complaint).

## 4. Workstation homepage — the Jason mockup (this sprint's deliverable)

Most-visited page; redesign it first, faithfully to the references, as the clickable mockup for the Wednesday check-in.

Layout top→bottom:
1. Page header: "Workstation" title + green primary action right (quick-add / complete-next)
2. Hero stat row: 4 cards — Overdue (red accent when >0), Due Today (blue), Upcoming (gray-blue), Waiting on Client (amber) — big blue numerals, small captions; clicking a stat filters the queue (stay-on-one-screen)
3. Segmented pills: bucket filter + day-of-week pills (keep keyboard j/k/E/X working)
4. Work cards: white cards, status footer band or left edge, dot+label status, statement balance inline (keep), hover lift, drag-drop triage preserved
5. "All caught up" celebration empty state when queue clears (dopamine: CheckDraw + confetti-lite, reduced-motion safe)
6. Focus-mode toggle (auto-prioritizer: show one card at a time) — Jason's ADD ask; can be a simple pill toggle that collapses the queue to the single next card with Next/Skip

Do NOT change queue data logic, bucket semantics, or keyboard contract — this is a visual/UX layer pass over `src/components/workstation/` + `src/server/queue.ts` view-models only.

## 5. Later pages (not this sprint)

Client detail (hero stat trio + contact card with avatar initials + segmented tabs + QBO-style billing timeline), intake wizard (carded steps + running-notes rail), portal parity, reports charts. Each follows this spec.

## 6. Hard constraints

- a11y gate must stay green (serious/critical axe = fail). Blue shift must preserve ≥4.5:1 for text/primary combinations.
- Dot+label status pairing never becomes color-alone.
- Dark theme must not regress.
- `prefers-reduced-motion` kills celebration animations.
- No changes to domain logic or queue semantics.
