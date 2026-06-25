# User Flows — Foodcart SaaS (Cycle 1)

> **Stage:** Design & Build — Design Discovery  
> **Owner:** UX Designer  
> **Inputs:** `DISCOVERY/JOB_STORIES.md`, `DISCOVERY/PERSONAS.md`, `BACKLOG.md`, `docs/SHAPED_BETS.md`, `ROADMAP.md`, reference templates  
> **Audience:** UI Technologist, Frontend Engineer, Backend Engineer, Tech Lead, UX Researcher

---

## 1. Onboarding Flow — 10-Minute Publish

**Goal:** A new owner signs up, imports or enters business data, picks a template, previews the generated site, and publishes it in under 10 minutes.

```text
[Marketing landing page]
    │
    ▼
[Sign up / Log in with Clerk]
    │  • One-click Google/Apple/email
    │  • On success, tenant + slug reserved immediately
    ▼
[Step 1 — Business Identity]
    │  • Business name (pre-fill from Clerk if available)
    │  • Desired subdomain slug (real-time availability check)
    │  • Cuisine type / vibe tag (used for template default)
    │  • Phone, timezone
    ▼
[Step 2 — Connect Existing Presence]
    │  • Google Business Profile OAuth / connect (primary)
    │  • Manual link fields: Yelp, DoorDash, UberEats, Grubhub,
    │    Instagram, Facebook, TikTok, existing website, menu URL
    │  • Ingestion progress indicator + per-source status
    │  • If a source fails → inline manual fallback with editable preview
    ▼
[Step 3 — Brand Assets]
    │  • Logo upload / generated fallback
    │  • Hero image upload / generated fallback
    │  • Option to skip and use template defaults
    ▼
[Step 4 — Template Match]
    │  • Three template cards with live thumbnails:
    │    – Banh Mi Fusion (bold / diagonal)
    │    – Real Indian Food (warm / heritage)
    │    – Mis Abuelos (family / Mexican warmth)
    │  • Cuisine default highlighted; owner can override
    ▼
[Step 5 — Generated Preview]
    │  • Desktop / mobile viewport toggle
    │  • All required sections rendered from ingested blocks
    │  • "Edit" shortcuts for headline, hours, menu stub
    ▼
[Publish Confirmation]
    │  • One-click "Publish" → live at slug.foodcartsite.com
    │  • Option to "Save as draft" and enter dashboard
    │  • Post-publish share sheet: copy link, QR code, Instagram bio tip
```

### Accessibility Notes
- Each step has a clear `<h1>` and progress indicator (`aria-valuenow`).
- Slug field announces availability result via `aria-live="polite"`.
- Upload fields have visible labels, focus rings, and keyboard-triggerable file picker.
- Primary action is always the last focusable element in the step; secondary action precedes it.

---

## 2. Admin Dashboard Flow — Edit, Preview, Publish

**Goal:** Owner returns to make quick, mobile-first updates and control publish state.

```text
[Admin Dashboard — Home]
    │
    ├─── [Site Health Card]
    │      • Publish state toggle (Draft / Published)
    │      • Public URL + copy button
    │      • Last edited timestamp
    │
    ├─── [Quick Wins / AI Assistant]
    │      • Chat-style input: "What do you want to update?"
    │      • Recent changes list
    │
    ├─── [Business Info]
    │      • Name, tagline, phone, email, social/order links
    │      • Logo + hero image
    │
    ├─── [Hours & Location]
    │      • Weekly schedule per day
    │      • Special hours overrides (next 14 days)
    │      • Live open/closed badge preview
    │
    ├─── [Menu]
    │      • Categories + items + prices + dietary tags
    │      • Sold-out toggle, daily special flag
    │
    └─── [Story / Catering / Contact]
           • Section on/off toggles + copy editors
           • Catering blurb + inquiry form preview
```

### Edit → Preview → Publish Micro-Flow

```text
[Owner taps any editable field]
    │
    ▼
[Inline or bottom-sheet editor opens]
    │  • Field-level save / cancel
    │  • Validation messages inline
    ▼
[Change saved as draft revision]
    │
    ▼
[Owner taps "Preview"]
    │  • Opens generated site in preview mode with banner:
    │    "Preview — not yet published"
    ▼
[Owner taps "Publish" from preview or dashboard]
    │  • Confirmation modal on first publish per session
    ▼
[Live site updated; cache invalidated]
```

### Accessibility Notes
- Dashboard uses a single-page app pattern with landmark regions (`<main>`, `<nav>`, `<aside>`).
- Focus is trapped inside bottom-sheet editors until dismissed.
- Publish toggle has `role="switch"` and announces state changes.
- All icons paired with text labels; no icon-only controls except QR/copy, which have `aria-label`.

---

## 3. Preview / Publish Flow

**Goal:** Owner can validate changes on both viewports before they are public.

```text
[Edit in dashboard]
    │
    ▼
[Preview mode]
    │  • Viewport toggle: Mobile (default) / Desktop
    │  • Floating preview banner:
    │    – Status: Draft / Ready to publish
    │    – "Back to dashboard" link
    │    – "Publish" primary button
    │  • Generated consumer site renders with latest draft blocks
    ▼
[Publish action]
    │  • Modal: "Publish changes to slug.foodcartsite.com?"
    │  • Primary: "Publish now"  /  Secondary: "Keep editing"
    ▼
[Published state]
    │  • Success toast: "Your site is live"
    │  • Dashboard card updates to "Published"
    │  • Public URL and QR code shown
    ▼
[Unpublish action]
    │  • Toggle or menu action
    │  • Confirmation modal
    │  • Site returns 404 at slug
```

### Accessibility Notes
- Preview banner is the first focusable element when entering preview mode.
- Viewport toggle is a `role="radiogroup"` with `aria-checked`.
- Publish confirmation modal traps focus and has an explicit heading.

---

## 4. AI Website Assistant Flow — Prompt → Preview → Approve

**Goal:** Owner requests a change in plain language, reviews a structured diff, and explicitly approves or rejects it.

```text
[Admin Dashboard — AI Assistant input]
    │
    ▼
[Owner types request, e.g. "Add vegan section to menu"]
    │  • Character limit shown
    │  • Example prompts below input for discoverability
    ▼
[Submit → loading state]
    │  • Skeleton diff card while LLM responds
    │  • Timeout / error state with retry
    ▼
[ChangePreview returned]
    │  • Human-readable summary
    │  • Before / after diff (text or structured table)
    │  • Confidence score (low/medium/high) — shown for transparency
    │  • Scope note: "This will update Menu only"
    ▼
[Owner chooses]
    │
    ├─── [Approve]
    │      • System creates a Revision snapshot of current state
    │      • Applies change to draft
    │      • Shows inline preview link
    │      • Logs action to audit trail
    │
    ├─── [Reject]
    │      • Dismisses preview
    │      • Optional feedback: "Tell us why"
    │      • Returns to assistant input
    │
    └─── [Modify prompt]
           • Edits original prompt and resubmits
```

### Prohibited Requests
If the assistant receives a request outside the allowlist (account, billing, auth, slug/domain, cross-tenant, code/SQL), it returns a friendly refusal:

> "I can only help update your site content — like menu, hours, story, and links. For account or billing changes, please contact support."

### Accessibility Notes
- AI input has a visible label (`aria-label="Ask the assistant to update your site"`).
- Diff preview uses semantic lists/tables; screen-reader users hear "Added," "Removed," or "Changed" before each item.
- Approve/Reject buttons are adjacent and equally discoverable; focus lands on the summary after load.
- Loading state announced via `aria-live="polite"`.

---

## 5. Error & Edge Flows

| Scenario | Flow | Notes |
|---|---|---|
| Ingestion source fails | Inline warning + manual fallback field; user can continue | Does not block onboarding |
| Slug unavailable | Suggest 3 alternatives; allow manual retry | Real-time check |
| AI returns invalid diff | Show error: "I couldn't build a safe preview. Try rephrasing." | Log to observability |
| AI request prohibited | Refusal message + link to support for account/billing | No mutation attempted |
| Publish fails | Retry button + contact support if repeated | Toast + dashboard banner |
| Tenant isolation breach | 403 screen, log out, support link | Security-critical path |

---

## Flow Traceability

| Flow | Primary Job Stories | Shaped Bet | Success Criteria |
|---|---|---|---|
| Onboarding | JS-01, JS-06 | Bet 1 | Time to publish < 10 min; publish rate ≥ 60% |
| Admin dashboard | JS-02, JS-04, JS-05 | Bet 1 + Bet 2 | Mobile update time < 60 s; section completeness ≥ 6/7 |
| Preview / publish | JS-01, JS-09 | Bet 1 | One-click publish; unpublish returns 404 |
| AI assistant | JS-07, JS-09 | Bet 3 (spike/build) | ≥ 80% approved without rework; 0 guardrail breaches |

---

## Open Questions for Validation

1. Is 5 steps the right cognitive load for onboarding, or should identity + links be combined?
2. Should AI assistant be available during onboarding, or only from the dashboard?
3. Do owners prefer a side-by-side diff or a simple "after" preview with changed items highlighted?
4. Is the mobile viewport the right default for preview, given owners manage from phones?
