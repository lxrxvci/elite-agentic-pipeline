# Design Specs — Foodcart SaaS Cycle 1

> **Stage:** Design & Build — Design Discovery  
> **Owner:** UX Designer  
> **Audience:** UI Technologist, Frontend Engineer, Backend Engineer, Tech Lead
>
> These specs translate discovery insights into actionable design requirements. They are validated outputs intended for high-fidelity prototyping and engineering handoff.

---

## 1. Design Principles

1. **Mobile-first, cart-first.** Owners manage the business from a phone while standing in a cart. Every edit flow must work one-handed on a small screen.
2. **Speed over polish.** Reduce decisions and taps. Default everything; let owners override only when they care.
3. **Trust through transparency.** Previews, diff views, and revert options are not edge cases — they are core to the experience.
4. **Authentic by default.** Templates should feel food-native, not generic SaaS.
5. **Safety before magic.** The AI assistant is a suggestion engine; it never mutates without explicit approval.

---

## 2. Information Architecture

### 2.1 Public Site (Generated Consumer Site)

Single-page anchor navigation:

```
#hero
#menu
#order
#story
#locations
#catering
#contact
```

Required sections (per `BACKLOG.md` Bet 1 acceptance criteria):

1. Hero — name, tagline, open/closed badge, primary CTAs.
2. About / Story — 2–4 paragraphs + image.
3. Menu — categories, items, prices, dietary tags.
4. Locations / Hours — address, phone, hours grid, live status.
5. Catering — packages/blurb + inquiry form.
6. Contact — phone, email, social links.
7. Order links — direct order + delivery apps.

### 2.2 Admin Dashboard

```
/dashboard
├── /site                    (publish state, public URL, QR)
├── /business-info           (name, tagline, phone, email, logo, hero)
├── /hours-location          (weekly schedule, special hours, address)
├── /menu                    (categories, items, prices, tags)
├── /story                   (about text, images)
├── /catering                (blurb, form fields)
├── /contact-social          (social links, order links)
└── /changes                 (recent edits + revert)
```

### 2.3 Onboarding

```
/onboarding
├── /identity
├── /links
├── /assets
├── /template
└── /preview
```

---

## 3. Template System

### 3.1 Template Overview

| Template | Vibe | Primary Colors | Typography | Signature Elements |
|---|---|---|---|---|
| **Banh Mi Fusion** | Bold, energetic, diagonal | Navy `#1A1A3E`, Saffron `#E86A33`, Magenta `#C2185B`, Gold `#D4A017`, Cream `#FFF8E1` | Rubik (display), Inter (body) | Diagonal section dividers, marquee strip, scroll-driven reveals |
| **Real Indian Food** | Warm heritage, storytelling | Dark navy, saffron/orange accent, cream | Bold condensed display + legible body | Large typographic hero, heritage imagery, structured menu |
| **Mis Abuelos** | Family warmth, Mexican authenticity | Bright blue, warm gold/amber, white | Heavy display + friendly sans | Generational language, food-cart photography, welcoming CTAs |

### 3.2 Template Selection Logic

- Default template suggested by cuisine/vibe tag from onboarding.
- Owner can override with one tap.
- Template choice stored as a content block (`template_id`), not hard-coded at build time.

### 3.3 Theming Tokens

Use `design-system/tokens.json` for base tokens. Template-specific tokens extend globals:

```json
{
  "template": {
    "banhmi": {
      "colors": { "primary": "#E86A33", "secondary": "#1A1A3E" },
      "fonts": { "display": "Rubik", "body": "Inter" }
    },
    "real-indian": {
      "colors": { "primary": "#E86A33", "secondary": "#1A1A3E" },
      "fonts": { "display": "Rubik", "body": "Inter" }
    },
    "mis-abuelos": {
      "colors": { "primary": "#D4A017", "secondary": "#1E5AA8" },
      "fonts": { "display": "Rubik", "body": "Inter" }
    }
  }
}
```

> **DesignOps note:** New template tokens must be reviewed before finalizing. Do not introduce new components without approval.

---

## 4. Component Specs

### 4.1 Global Components

| Component | Spec | Acceptance Criteria |
|---|---|---|
| **Button Primary** | `component.button-primary` token; min touch 44 × 44 px | High contrast; visible focus ring; loading state with spinner and disabled |
| **Button Secondary** | Outline or ghost variant | Same focus behavior; visible in both light and dark template surfaces |
| **Input** | `component.input` token; label above, error below | `aria-invalid` on error; helper text linked via `aria-describedby` |
| **Toggle / Switch** | Used for publish/unpublish, open/closed per day | `role="switch"`; label describes current state |
| **Card** | `component.card` token | Consistent padding, shadow, radius across dashboard |
| **Modal** | `component.modal` token | Focus trap; close on Escape; focus returns to trigger |
| **Toast** | Success / error / warning | `role="status"` or `role="alert"`; auto-dismiss with pause on hover/focus |
| **Bottom Sheet** | Mobile-first editor container | Slides up from bottom; drag handle for pointer users; full keyboard support |

### 4.2 Domain Components

| Component | Spec | Acceptance Criteria |
|---|---|---|
| **Slug Field** | Real-time availability + suggestion chips | Debounced validation; accessible status announcement |
| **Link Ingestion Card** | Source icon, status, manual fallback | Failed states do not block progress; inline edit |
| **Template Card** | Thumbnail + title + description | Single-select group; selected state visible without color alone |
| **Hours Day Row** | Day label, open/closed toggle, time selects | Copy-across-days action; special hours inline |
| **Open/Closed Badge** | Color-coded dot + text | Updates client-side without layout shift; timezone-aware |
| **Menu Item Card** | Image, name, description, price, dietary tags | Editable inline or via bottom sheet |
| **AI Assistant Input** | Chat-style prompt with examples | Character limit; loading skeleton; error retry |
| **Diff Preview** | Before/after or structured delta | Added/removed/changed items accessible; approve/reject actions |
| **Preview Banner** | Floating banner in preview mode | Clearly distinguishes draft vs. live; persistent but not intrusive |
| **QR Code Viewer** | Modal showing QR for public URL | Download/share actions; alt text for QR image |

---

## 5. Interaction Specs

### 5.1 Onboarding Interactions

| Interaction | Behavior |
|---|---|
| Step progression | Linear by default; back button always available; progress bar updated |
| Slug typing | Debounce 300 ms; show checking → available/unavailable + suggestions |
| Link ingestion | Show per-source status (pending / success / failed); failed → manual fallback |
| Asset upload | Drag-and-drop + click; show thumbnail; validate size/type |
| Template select | Tap/click card; highlight selected; continue enabled |
| Preview | Default mobile viewport; desktop toggle; quick-edit shortcuts |
| Publish | Confirmation modal; success toast + share sheet |

### 5.2 Dashboard Interactions

| Interaction | Behavior |
|---|---|
| Section tap | Opens editor inline or in bottom sheet (mobile) / side panel (desktop) |
| Save | Creates draft revision; shows success toast |
| Preview | Opens generated site in preview mode with banner |
| Publish toggle | Confirmation modal on unpublish; immediate state update on publish |
| AI prompt submit | Loading skeleton → diff preview; focus moves to summary |
| Revert | One-click revert per recent change; confirmation if AI-applied |

### 5.3 AI Assistant Interactions

| Interaction | Behavior |
|---|---|
| Prompt input | Placeholder rotates through examples; 280-char limit |
| Submit | Disabled if empty; loading skeleton shown |
| Valid preview | Summary + diff + confidence + Approve/Reject/Edit |
| Invalid / unsafe prompt | Friendly refusal; no mutation attempted; log event |
| Approve | Snapshot current revision → apply → show preview link |
| Reject | Dismiss preview; optional feedback; return to input |
| Error | Retry button; escalate to support if repeated |

---

## 6. Responsive Breakpoints

Use the project standard breakpoints:

| Breakpoint | Width | Usage |
|---|---|---|
| `sm` | 640 px | Phone landscape / small tablet |
| `md` | 768 px | Tablet |
| `lg` | 1024 px | Desktop |
| `xl` | 1280 px | Large desktop |

### Layout Rules

- **Onboarding:** Single column, max-width 720 px centered on desktop.
- **Dashboard:** Mobile = bottom nav + bottom sheets; desktop = fixed sidebar + main content.
- **Consumer site:** Mobile = stacked; tablet/desktop = reference-template layout (hero 2-col, menu grid, etc.).

---

## 7. Motion & Animation

### Required

| Animation | Rule |
|---|---|
| Focus rings | Immediate, no transition delay |
| Button hover | Subtle `translateY(-2px)` + shadow; respect `prefers-reduced-motion` |
| Toast entrance | Slide/fade; pause on hover/focus |
| Bottom sheet | Slide up; close on swipe down (pointer) or Escape (keyboard) |

### Restricted

| Animation | Rule |
|---|---|
| Auto-playing carousels | Not allowed unless pause/stop control is provided |
| Marquee / ticker | `aria-hidden`; must stop when `prefers-reduced-motion` is set |
| Scroll-driven reveals | Optional; disable for reduced motion; do not delay content |
| Loading skeletons | Use for AI and ingestion; do not block for > 5 s without feedback |

---

## 8. Content & Copy Guidelines

### Voice

- Friendly, direct, cart-owner-aware.
- Avoid jargon (“tenant,” “schema,” “deployment”).
- Use “your site,” “your customers,” “your link.”

### Key Strings

| Context | Copy |
|---|---|
| Onboarding CTA | “Get your site live” |
| Publish button | “Publish now” |
| Unpublish button | “Take site offline” |
| AI input placeholder | “What do you want to update?” |
| AI examples | “Add vegan section to menu”, “Change hero headline to Summer Specials”, “Update Friday hours to 11pm” |
| Diff summary prefix | “I’ll make these changes:” |
| Approval CTA | “Approve & apply” |
| Reject CTA | “Don’t apply” |
| Open status | “Open now — closes {time}” |
| Closed status | “Closed — opens {day} at {time}” |

---

## 9. Acceptance Criteria for UI Technologist

### Onboarding

- [ ] All 5 steps match wireframe structure and information hierarchy.
- [ ] Slug field provides real-time availability feedback with accessible status.
- [ ] Failed ingestion sources show inline manual fallback without blocking progress.
- [ ] Template selection defaults by cuisine/vibe and allows override.
- [ ] Preview defaults to mobile viewport with desktop toggle.
- [ ] Publish action shows confirmation modal and success share sheet.

### Admin Dashboard

- [ ] Home screen surfaces site status, AI assistant, section list, and recent changes.
- [ ] Section editors work on mobile via bottom sheets and on desktop via side panels.
- [ ] Hours editor supports day toggles, time selects, copy-across-days, and special hours.
- [ ] Publish/unpublish toggle requires confirmation for unpublish.
- [ ] All interactive elements meet 44 × 44 px touch target minimum.

### AI Assistant

- [ ] Input includes example prompts and character limit.
- [ ] Diff preview shows summary, before/after, confidence, and scope note.
- [ ] Approve creates a revision snapshot before applying.
- [ ] Reject dismisses preview without applying changes.
- [ ] Prohibited requests receive a friendly refusal and no mutation.

### Consumer Site

- [ ] Renders all 7 required sections.
- [ ] Live open/closed badge is timezone-aware and avoids layout shift.
- [ ] Navigation supports skip link, landmarks, and anchor links.
- [ ] Direct order and delivery-app links are prominent and trackable.
- [ ] Template rendering respects `prefers-reduced-motion`.

### Cross-Cutting

- [ ] Color contrast meets WCAG 2.1 AA across all key screens.
- [ ] Focus order is logical and focus indicators are visible.
- [ ] All form inputs have associated labels and error states.
- [ ] All icons paired with text or meaningful `aria-label`.
- [ ] `lang` attribute and page titles are correct per route.

---

## 10. Handoff Checklist

Before passing to engineering, the UX Designer and UI Technologist confirm:

- [ ] Wireframes reviewed and annotated.
- [ ] High-fidelity prototypes linked in `design/HIFI_PROTOTYPES.md` (when ready).
- [ ] `design/DEV_HANDOFF.md` includes component names, tokens, and responsive rules.
- [ ] Accessibility checklist reviewed with Frontend Engineer and SDET.
- [ ] Usability test plan scheduled or already run.
- [ ] Open questions documented for product trio.

---

## 11. Open Questions

1. Should the onboarding preview allow direct text editing (inline WYSIWYG) or only section shortcuts?
2. Does the AI assistant input need voice input support for phone-first operators?
3. Should the dashboard default to the most recently edited section on return?
4. What is the fallback consumer-site state when ingestion yields no menu items?
5. How should the system handle dietary tags across cuisines (vegan, gluten-free, halal, etc.)?
