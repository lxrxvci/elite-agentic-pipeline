# High-Fidelity Prototypes — Foodcart SaaS

> These descriptions define the visual design, interaction, and token/component usage for the four core screen groups. They are the handoff artifact for Frontend Engineering.

---

## 1. Onboarding Flow

A five-step, mobile-first publish flow. Each step is a full-screen card on mobile and a centered modal/panel on desktop.

### Visual system

- **Background**: `semantic.color.background-subtle` (`neutral-50`) behind a floating white card.
- **Card**: `component.card` — white, `1rem` radius, `shadow-card`, `p-6 md:p-10`.
- **Stepper**: `OnboardingStepper` pinned to the top of the card.
- **Primary action**: `Button` primary, full width on mobile, auto on desktop.
- **Secondary action**: `Button` ghost, "Back".

### Step 1 — Business identity

- Fields: Business name, desired slug (`slug.foodcartsite.com`), cuisine type (select).
- Slug field shows inline availability state using `feedback-success-text` or `feedback-danger-text`.
- `Input` components stacked with `stack-lg` (`1.5rem`) gaps.

### Step 2 — Connect presence

- A list of link inputs: Google Business Profile, Yelp, DoorDash, UberEats, Grubhub, Instagram, Facebook, TikTok, website, menu URL.
- Each row is a `Card` flat variant with an icon, label, and `Input`.
- GBP row has a primary "Connect" button; everything else is manual URL entry.
- Helper text uses `semantic.font.body-sm` and `text-secondary`.

### Step 3 — Brand assets

- Logo upload drop zone using a dashed `Card` with `border-dashed` override.
- Hero image upload with a preview thumbnail.
- Fallback placeholders use template-specific neutral food imagery.

### Step 4 — Template match

- `TemplateSelector` in grid layout.
- Cards are `component.templateSelector` with 4:3 preview thumbnails.
- Selected template receives the `selected` border + ring.

### Step 5 — Preview & publish

- Split view on desktop: left summary (business name, slug, template), right `PreviewFrame` in mobile mode by default.
- A "Publish now" `Button` primary triggers the tenant creation and subdomain activation.
- Post-publish success uses a full-bleed `Card` with `feedback-success-bg` and a confetti-safe success icon.

### Accessibility

- Each step is a `<form>` with proper `<label>`/`id` bindings.
- Stepper provides navigation state via `aria-current` and `aria-disabled`.
- Focus order follows top-to-bottom form flow.

---

## 2. Admin Dashboard

The owner home after publish. Layout is responsive: a top app bar, a collapsible left nav on desktop, and a main content area that shows either the editor or the preview.

### App bar

- Height `4rem`, background `semantic.color.surface-default`, bottom border `semantic.color.border-default`.
- Left: Foodcart logo + tenant name.
- Right: publish toggle (`Switch`), owner avatar menu, and an "AI Assistant" toggle button.

### Editor view

- Navigation tabs: **Site**, **Business info**, **Hours**, **Links**, **Appearance**.
- Each tab uses `Card` containers with `stack-xl` spacing.
- Inputs use `component.input`.
- Live preview updates in a `PreviewFrame` to the right on `lg` screens, or via a "Preview" button on mobile.

### Hours editor tab

- Day rows replicate `HoursGrid` but with editable toggles and time pickers.
- Open/closed toggle uses `Switch`.
- Special-hours override section sits below the regular grid.

### Links tab

- Social and order platform rows use `SocialLinks` and `OrderLinks` in read mode; editing opens inline `Input` fields.

### Appearance tab

- `TemplateSelector` grid for switching templates.
- Color swatches are derived from `semantic.template.*` and are read-only in this cycle (template-driven).

### Accessibility

- Dashboard tabs are a `role="tablist"` with `aria-selected`.
- All form sections have `<fieldset>` + `<legend>`.
- Publish toggle announces state changes via `aria-live`.

---

## 3. AI Assistant Panel

A slide-over chat panel on the right edge of the dashboard.

### Visual system

- Width `26rem` (`component.aiAssistantPanel.width`).
- Background `surface-default`, left border `border-default`, shadow `elevated`.
- Header `background-subtle` with close button.
- Messages use `component.aiAssistantPanel.messageUser` (cobalt bubble) and `messageAssistant` (neutral bubble).

### Conversation flow

1. Owner types a request, e.g., "Add vegan section to menu."
2. User bubble appears immediately.
3. Loading ellipsis pulses while the backend builds a `ChangePreview`.
4. Assistant bubble explains the change, followed by a diff card.
5. Diff card uses `diffAdded` (`success-100`/`success-700`) and `diffRemoved` (`danger-100`/`danger-700`).
6. Owner taps **Looks good** or **Revise**.
7. On approve, a `Revision` snapshot is created and the change is applied; the preview frame refreshes.

### Guardrail states

- If a request is outside the allowlist, an inline `feedback-danger-bg` alert appears: "I can only update menu, hours, story, hero, links, or catering."
- Rate-limit or error states use `feedback-warning-bg` with a retry button.

### Accessibility

- Panel has `aria-label="AI Website Assistant"`.
- Message list is a live region.
- Approve/Reject buttons are keyboard accessible and labeled by the diff summary.

---

## 4. Generated Site

A single-page, mobile-first site rendered from the active template and content blocks.

### Common structure

All templates share these sections; colors, fonts, and decorative shapes are template-specific.

| Section | Template mapping | Tokens |
|---|---|---|
| Header | Fixed nav, logo, CTAs | `semantic.template.*`, `semantic.font.label` |
| Hero | Large display headline, status badge, CTA row | `semantic.font.display-xl`, template primary/accent |
| Marquee strip (optional) | Scrolling tagline | Template secondary |
| Story / About | Image + text | `semantic.font.body-lg`, template surfaceAlt |
| Menu | Featured carousel + full menu categories | `MenuSection` tokens |
| Order | Platform buttons | `OrderLinks` tokens |
| Locations & Hours | `LocationCard` + `HoursGrid` | Template status badge colors |
| Catering | Two-column layout with lead form | Template surfaceAlt, card tokens |
| Footer | Nav, social, copyright | Template text/inverse |

### Template A — Banh Mi Fusion

- **Mood**: bold diagonal energy.
- **Surface**: bright yellow (`banhmi-yellow`) alternating with black (`banhmi-black`).
- **Hero**: oversized `display-xl` black uppercase text; the last word is coral (`banhmi-coral`).
- **Diagonal sections**: `clip-path: polygon(0 0, 100% 0, 100% calc(100% - 50px), 0 100%)` between sections.
- **Buttons**: black pill with yellow text primary; coral pill for catering.
- **Menu**: featured carousel on yellow background, full menu on coral background.
- **Status badge**: black pill with a pulsing coral dot.

### Template B — Real Indian Food

- **Mood**: warm heritage storytelling.
- **Surface**: deep navy (`real-navy`) with cream-white text (`real-creamwhite`), alternating with cream (`real-cream`).
- **Hero**: display headline in cream; saffron accent word.
- **Story**: offset gold border around the image; italic gold pull quote.
- **Buttons**: saffron primary; magenta secondary.
- **Menu**: saffron section background, gold category labels, cream cards.
- **Locations**: cream card on a cream section, saffron status badge.

### Template C — Mis Abuelos

- **Mood**: family Mexican warmth.
- **Surface**: cobalt blue (`misa-cobalt`) with white text; cream (`misa-cream`) for alternating sections.
- **Hero**: white display headline; last word in gold (`misa-gold`); food-cart illustration on the right.
- **Buttons**: gold primary; terracotta/adobe secondary.
- **Menu**: cobalt section with white text and gold category labels.
- **Locations**: cream card with cobalt text, terracotta status badge.

### Mobile behavior

- Header collapses to a hamburger menu overlay.
- Menu carousel is swipeable with scroll-snap.
- Hours grid collapses to a single column.
- All CTA buttons stack full-width.

### Accessibility

- Semantic `<main>`, `<section>`, `<nav>`, `<footer>`.
- Skip-to-content link at the top.
- Focus order follows visual order; hamburger menu traps focus while open.
- Reduced-motion: disable marquee and GSAP scroll animations; respect `prefers-reduced-motion`.

---

## Token quick reference for prototypes

| Concept | Token(s) |
|---|---|
| Admin primary action | `component.button.primary` → `semantic.color.interactive-default` |
| Admin surface | `component.card` → `semantic.color.surface-default` |
| Template palette | `semantic.template.{banhmi,real-indian,misabuelos}` |
| Display type | `semantic.font.display-xl` / `display-lg` |
| Body type | `semantic.font.body` / `body-lg` |
| Section spacing | `semantic.spacing.section-y`, `semantic.spacing.section-x` |
| Section radius | `semantic.radius.card` / `panel` |
| Elevation | `semantic.shadow.card` / `elevated` |
| Motion | `semantic.motion.transition-default`, `hover-lift` |
