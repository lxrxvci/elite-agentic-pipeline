# Accessibility Checklist — Foodcart SaaS Cycle 1

> **Stage:** Design & Build — Design Discovery  
> **Owner:** UX Designer  
> **Standard:** WCAG 2.1 Level AA  
> **Scope:** Onboarding, admin dashboard, preview/publish, AI assistant, generated consumer site

---

## How to Use This Checklist

- **UX / UI Technologist:** Use during design and component spec handoff.
- **Frontend Engineer:** Verify during implementation; pair with automated tooling (`axe`, Lighthouse, `eslint-plugin-jsx-a11y`).
- **SDET:** Include in accessibility regression tests.
- **UX Researcher:** Validate with 1–2 screen-reader or keyboard-only sessions.

---

## 1. Perceivable

### 1.1 Text Alternatives

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| P1.1 | Images have meaningful alt text | Logo, hero image, menu item photos, map thumbnails, social icons | Decorative images use `alt=""`; informative images have descriptive alt; functional icons have `aria-label` |
| P1.2 | Non-text content is perceivable | Template thumbnails, status dots, diff `+`/`-` indicators | Color is not the only means of conveying meaning; status paired with text (“Open”, “Closed”) |

### 1.2 Time-based Media

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| P2.1 | Marquee / ticker is accessible | Scrolling text strip in Banh Mi Fusion template | Uses `aria-hidden="true"` and does not auto-update live regions; static equivalent nearby |

### 1.3 Adaptable

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| P3.1 | Content order is logical | All pages | DOM order matches visual order; CSS does not reposition focusable elements confusingly |
| P3.2 | Responsive reflow | Onboarding, dashboard, consumer site | Content readable at 320 px width without horizontal scrolling |
| P3.3 | Labels and instructions | Form inputs, toggles, selects | Every input has an associated `<label>` or `aria-labelledby`; required fields marked |

### 1.4 Distinguishable

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| P4.1 | Color contrast | Text, icons, focus rings, buttons | Normal text ≥ 4.5:1; large text ≥ 3:1; UI components ≥ 3:1 |
| P4.2 | Focus visible | All interactive elements | `component.focus-ring` applied consistently; focus is not suppressed |
| P4.3 | Text resize | All content | Text readable up to 200% zoom without loss of function |

---

## 2. Operable

### 2.1 Keyboard Accessible

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| K1.1 | Full keyboard navigation | Onboarding steps, dashboard, preview, AI assistant | All functionality reachable via `Tab`/`Shift+Tab`; no keyboard traps except intentional modals |
| K1.2 | Logical tab order | All pages | Tab order follows visual flow and section order |
| K1.3 | Skip links | Consumer site, dashboard | “Skip to main content” link is the first focusable element |
| K1.4 | Modal focus trap | Publish/unpublish confirmation, AI diff preview, editors | Focus trapped while open; focus restored on close |

### 2.2 Enough Time

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| K2.1 | No auto-timeout | Onboarding, forms | Users can save progress; no session timeouts without warning |
| K2.2 | No auto-advancing carousel | Template previews, menu carousels | Manual controls provided; no auto-play that cannot be paused |

### 2.3 Seizures and Physical Reactions

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| K3.1 | Motion safety | Scroll-driven animations, status pulse, button hover | No flashing > 3 Hz; `prefers-reduced-motion` disables non-essential motion |

### 2.4 Navigable

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| K4.1 | Page titles | All routes | Unique, descriptive `<title>` per view |
| K4.2 | Headings | All pages | Single `<h1>` per page; hierarchy does not skip levels |
| K4.3 | Landmark regions | Dashboard, consumer site | `<header>`, `<nav>`, `<main>`, `<footer>`, `<aside>` used correctly |
| K4.4 | Link purpose | All links | Link text describes destination; no “click here” |
| K4.5 | Current location | Dashboard nav, consumer site nav | `aria-current="page"` on active item |

### 2.5 Input Modalities

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| K5.1 | Touch target size | Mobile dashboard, onboarding | Minimum 44 × 44 CSS px for all touch targets |
| K5.2 | Gesture alternatives | Mobile menu swipe, carousel | Same action available via button/tap |

---

## 3. Understandable

### 3.1 Readable

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| U1.1 | Language of page | All pages | `<html lang="en">` (or appropriate language) |
| U1.2 | Simple language | AI summaries, error messages, onboarding copy | Flesch-Kincaid Grade 8 or lower; jargon explained |

### 3.2 Predictable

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| U2.1 | Consistent navigation | Dashboard, consumer site | Nav in same location and order across views |
| U2.2 | Consistent labels | Buttons, links, icons | Same label = same action; icons paired with text or `aria-label` |
| U2.3 | No unexpected change of context | Slug check, auto-save, publish toggle | Focus and context do not change automatically on input |

### 3.3 Input Assistance

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| U3.1 | Error identification | Onboarding forms, hours editor, AI input | Errors identified in text near field; `aria-invalid` set |
| U3.2 | Error suggestion | Slug field, URL inputs, hours | Suggestions provided when known (e.g., slug alternatives, URL format) |
| U3.3 | Confirmation for destructive actions | Unpublish, reject AI diff, delete item | Modal confirmation before data loss or public change |

---

## 4. Robust

| ID | Requirement | Applies To | Acceptance Criteria |
|---|---|---|---|
| R1.1 | Valid HTML | All pages | Passes W3C validator; no duplicate IDs |
| R1.2 | ARIA used correctly | Modals, toggles, tabs, live regions | Roles, states, and properties follow WAI-ARIA Authoring Practices |
| R1.3 | Status messages | Ingestion progress, AI loading, publish toast | `aria-live="polite"` for non-critical updates; `aria-live="assertive"` for errors |

---

## Screen-Reader Specific Considerations

| Screen | Key Considerations |
|---|---|
| **Onboarding** | Progress bar read as “Step 2 of 5”; slug availability announced; template cards read as radio group with description |
| **Dashboard** | Section list read as navigation; bottom-sheet editors announced as dialogs; publish toggle read as switch |
| **AI Assistant** | Loading state announced; diff read with “Added,” “Removed,” or “Changed” prefixes; Approve/Reject buttons clearly labeled |
| **Consumer Site** | Skip link, landmark navigation, menu items with price and dietary tags, live status badge updated without interrupting |

---

## Focus Order Specifications

### Onboarding Step (Generic)

```
1. Back button (if present)
2. Step indicator (focusable for screen readers)
3. Heading
4. First form field
5. Subsequent form fields
6. Skip/Secondary action
7. Primary action (Continue / Publish)
```

### Dashboard Home

```
1. Skip to main content
2. Mobile menu toggle / desktop nav links
3. Site health card → copy link → view QR → unpublish toggle
4. AI assistant input
5. Section list (Business Info, Hours, Menu, Story, Catering, Contact)
6. Recent changes list
```

### AI Assistant Diff Preview

```
1. Back to assistant
2. User prompt text (read-only)
3. Summary list
4. Diff preview (navigable list)
5. Edit prompt button
6. Reject button
7. Approve & apply button
```

---

## Checklist Sign-Off

| Role | Name | Date | Status |
|---|---|---|---|
| UX Designer | | | |
| UI Technologist | | | |
| Frontend Engineer | | | |
| SDET | | | |
| Accessibility Reviewer | | | |

---

## References

- [WCAG 2.1 AA Quick Reference](https://www.w3.org/WAI/WCAG21/quickref/)
- [WAI-ARIA Authoring Practices 1.2](https://www.w3.org/WAI/ARIA/apg/)
- `design-system/tokens.json` — focus-ring, color, and spacing tokens
