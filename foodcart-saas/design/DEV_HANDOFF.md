# Developer Handoff — Foodcart SaaS UI

> This document maps design-system tokens and components to implementation files, responsive behavior, accessibility requirements, and animation notes.

---

## 1. Token-to-code pipeline

### File

- `design-system/tokens.json` is the single source of truth.
- A build-time transformer (Style Dictionary or a custom script) should flatten references into CSS custom properties or a Tailwind theme extension.

### Reference syntax

Tokens use `{tier.group.path[.sub]}` references:

```text
{global.color.cobalt-600}
{semantic.color.interactive-default}
{component.button.primary.background}
```

### Tailwind mapping (recommended)

```js
// tailwind.config.js
module.exports = {
  theme: {
    extend: {
      colors: {
        'brand-primary': '#2563eb',
        'brand-secondary': '#dbeafe',
        'banhmi-yellow': '#f5e100',
        'banhmi-coral': '#ff6b5b',
        'real-navy': '#1a1a3e',
        'real-saffron': '#e86a33',
        'real-gold': '#d4a017',
        'misa-cobalt': '#1e5caa',
        'misa-gold': '#d4a017',
      },
      fontFamily: {
        display: ['Rubik', 'system-ui', 'sans-serif'],
        body: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 4px 20px rgba(0, 0, 0, 0.08)',
        elevated: '0 8px 32px rgba(0, 0, 0, 0.12)',
      },
      borderRadius: {
        '2xl': '1rem',
      },
    },
  },
}
```

### CSS custom properties (fallback)

```css
:root {
  --fc-color-text-primary: #0a0a0a;
  --fc-color-text-secondary: #737373;
  --fc-color-interactive: #2563eb;
  --fc-font-display: Rubik, system-ui, sans-serif;
  --fc-spacing-section-y: clamp(5rem, 10vh, 8.75rem);
  --fc-shadow-card: 0 4px 20px rgba(0, 0, 0, 0.08);
}
```

---

## 2. Component-to-code mapping

| Design component | Suggested FSD path | Tokens consumed | Notes |
|---|---|---|---|
| `Button` | `src/shared/ui/Button.tsx` | `component.button.*`, `semantic.color.focus-ring` | Use `cva` or class variants for `primary/secondary/outline/ghost/danger`. |
| `Card` | `src/shared/ui/Card.tsx` | `component.card.*` | Support `default`, `flat`, `selected`, `template` variants. |
| `Input` | `src/shared/ui/Input.tsx` | `component.input.*` | Always paired with `Label`. Use `Field` wrapper if available. |
| `OnboardingStepper` | `src/features/onboarding/ui/OnboardingStepper.tsx` | `component.onboardingStepper.*` | Steps array passed from route state. |
| `TemplateSelector` | `src/features/template/ui/TemplateSelector.tsx` | `component.templateSelector.*` | Radio group semantics. |
| `MenuSection` | `src/features/site/ui/MenuSection.tsx` | `component.menuSection.*`, `semantic.template.*` | Theme-aware; split into FeaturedCarousel and FullMenu subcomponents. |
| `LocationCard` | `src/features/site/ui/LocationCard.tsx` | `component.locationCard.*`, `semantic.template.*` | Includes live status badge. |
| `HoursGrid` | `src/shared/ui/HoursGrid.tsx` | `component.hoursGrid.*` | Used inside LocationCard and admin editor. |
| `SocialLinks` | `src/shared/ui/SocialLinks.tsx` | `component.socialLinks.*` | Accepts `inverse` prop for dark backgrounds. |
| `OrderLinks` | `src/shared/ui/OrderLinks.tsx` | `component.orderLinks.*` | Per-platform colors; opens externally. |
| `PreviewFrame` | `src/features/preview/ui/PreviewFrame.tsx` | `component.previewFrame.*` | Sandboxed iframe; mobile/desktop toggle. |
| `AIAssistantPanel` | `src/features/assistant/ui/AIAssistantPanel.tsx` | `component.aiAssistantPanel.*` | Slide-over; manages diff preview and approval. |

### Section components for generated sites

| Section | Suggested path | Depends on |
|---|---|---|
| `Header` | `src/features/site/ui/Header.tsx` | `Button`, `SocialLinks` |
| `HeroSection` | `src/features/site/ui/HeroSection.tsx` | `Button`, template tokens |
| `MarqueeStrip` | `src/features/site/ui/MarqueeStrip.tsx` | template secondary color |
| `StorySection` | `src/features/site/ui/StorySection.tsx` | template tokens |
| `MenuSection` | `src/features/site/ui/MenuSection.tsx` | `Card`, `HoursGrid` |
| `OrderSection` | `src/features/site/ui/OrderSection.tsx` | `OrderLinks` |
| `LocationsSection` | `src/features/site/ui/LocationsSection.tsx` | `LocationCard`, `HoursGrid` |
| `CateringSection` | `src/features/site/ui/CateringSection.tsx` | `Input`, `Button` |
| `Footer` | `src/features/site/ui/Footer.tsx` | `SocialLinks`, `OrderLinks` |

---

## 3. Responsive behavior

### Breakpoints

| Token | Value | Usage |
|---|---|---|
| `global.breakpoint.sm` | `640px` | 2-column forms, stacked CTAs side-by-side |
| `global.breakpoint.md` | `768px` | Dashboard left nav appears; menu carousel arrows shown |
| `global.breakpoint.lg` | `1024px` | Split editor/preview layout |
| `global.breakpoint.xl` | `1280px` | Max container width `75rem` reached |

### Patterns

- **Mobile-first**: default styles are for `375px` viewport.
- **Section padding**: use `semantic.spacing.section-x` (`clamp(1.25rem, 4vw, 4rem)`) for horizontal padding.
- **Section vertical rhythm**: `semantic.spacing.section-y` (`clamp(5rem, 10vh, 8.75rem)`).
- **Container**: `max-w-6xl mx-auto` (`75rem`).
- **Generated site nav**: hamburger overlay below `md`.
- **Dashboard**: single column below `lg`; preview frame becomes a full-width drawer/modal on mobile.
- **Template selector**: 1 column → 3 columns at `sm`.
- **Menu full grid**: 1 column → 2 columns at `md`.
- **Location cards**: 1 column → 2 columns at `md`.

---

## 4. Accessibility annotations

### Global requirements

- Target touch size: minimum `44×44px` for all interactive controls.
- Focus ring: `2px` solid `semantic.color.focus-ring`, `2px` offset, visible only on `:focus-visible`.
- Color contrast: all text/background pairs must meet WCAG 2.1 AA (4.5:1 for normal text, 3:1 for large text).
- Motion: honor `prefers-reduced-motion: reduce` by disabling parallax, marquee, and entrance animations.

### Component-specific

| Component | Key a11y notes |
|---|---|
| `Button` | `aria-disabled` for disabled state; icon buttons require `aria-label`. |
| `Card` | Interactive cards must be `<button>` or `<a>` with visible focus. |
| `Input` | Always paired with `<label>`; error text linked via `aria-describedby`. |
| `OnboardingStepper` | `aria-current="step"`, `aria-disabled` for future steps. |
| `TemplateSelector` | `role="radiogroup"`; selected card announced via `aria-checked`. |
| `MenuSection` | Carousel `aria-roledescription="carousel"`; dietary tags have tooltips. |
| `LocationCard` | Status badge uses `aria-live="polite"`; icons are decorative. |
| `HoursGrid` | Use `<table>` or `<dl>` for day/time association. |
| `SocialLinks` | Each link has an `aria-label`. |
| `OrderLinks` | Platform name in accessible label. |
| `PreviewFrame` | Iframe has descriptive `title`; toolbar is `role="toolbar"`. |
| `AIAssistantPanel` | Live region for messages; diff uses semantic `ins`/`del`. |

---

## 5. Animation notes

### Motion tokens

| Token | Value | Usage |
|---|---|---|
| `semantic.motion.transition-fast` | `150ms cubic-bezier(0.4,0,0.2,1)` | Micro-interactions (button press, focus ring). |
| `semantic.motion.transition-default` | `200ms cubic-bezier(0.4,0,0.2,1)` | Hover lifts, border/color transitions. |
| `semantic.motion.transition-slow` | `300ms cubic-bezier(0,0,0.2,1)` | Panel slides, preview width changes. |
| `semantic.motion.hover-lift` | `translateY(-2px)` | Card and button hover. |
| `semantic.motion.slide-up` | `500ms ease-out` | Section entrance animations. |

### Entrance animations (generated sites)

- **Hero**: headline words stagger in `y: 40px → 0`, `opacity: 0 → 1`, stagger `80ms`, duration `700ms`.
- **Hero image**: `opacity: 0 → 1`, `scale: 0.95 → 1`, duration `800ms`.
- **Sections**: children fade/slide up when entering viewport at `top 85%`, stagger `100ms`.
- **Story section**: image slides from left, text from right.
- **Catering section**: two-column split from left/right.

### Continuous animations

- **Floating hero image**: `translateY(0 → -12px → 0)` over `4s` ease-in-out infinite.
- **Marquee strip**: `translateX(0 → -50%)` over `20s` linear infinite; pause on hover.
- **Status pulse dot**: `animate-pulse` (Tailwind) with reduced-motion fallback to static.

### Performance guardrails

- Use `transform` and `opacity` only for animations; avoid animating `clip-path` on scroll.
- Diagonal section clip-path is applied as a static CSS class, not recalculated on scroll.
- Respect `prefers-reduced-motion: reduce`: disable GSAP timelines, marquee, and float.
- Keep LCP under 2.5s: hero text should be server-rendered; animations run after hydration.

---

## 6. Reference template patterns to preserve

### Banh Mi Fusion

- **Bold diagonal branding**: alternating diagonal-section clip-paths; yellow/black/coral palette.
- **Hero**: massive uppercase `display-xl` with a coral accent word; cart illustration floats on the right.
- **Menu**: horizontal featured carousel with cream cards on coral background; full menu category rows with price in coral.
- **Locations**: grid of white cards on yellow background; black/coral status badges.
- **Catering**: black background, service cards with colored left borders, gold accents.

### Real Indian Food

- **Warm heritage**: navy background, cream-white text, saffron/gold accents.
- **Hero**: status badge pill, display headline, saffron CTA.
- **Story**: image with offset gold border; italic gold pull quote.
- **Menu**: saffron section, gold category labels, cream cards, price in gold.
- **Locations**: cream card, saffron iconography, live open/closed badge.

### Mis Abuelos

- **Family warmth**: cobalt blue background, white text, gold/terracotta accents.
- **Hero**: tall display headline, last word in gold, detailed food-cart illustration.
- **Buttons**: gold primary pill, brown/terracotta secondary pill.
- **Menu**: deep blue section with gold category labels.
- **Locations**: cream card with cobalt text and terracotta status badge.

---

## 7. Open questions for Frontend / Backend

1. Token transformer: Style Dictionary, custom script, or Tailwind plugin?
2. Animation library: GSAP + ScrollTrigger already proven in reference templates; is Lenis smooth scroll required?
3. Preview frame: server-side iframe URL or client-side rendered from content blocks?
4. Template switching: should the active template tokens be injected as CSS variables per tenant subdomain?
5. AI diff: `ins`/`del` or a custom diff component?
