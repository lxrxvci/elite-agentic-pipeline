# Wireframes — Foodcart SaaS (Cycle 1)

> **Stage:** Design & Build — Design Discovery  
> **Owner:** UX Designer  
> **Format:** Text-based wireframes (ASCII + structure notes)  
> **Audience:** UI Technologist, Frontend Engineer, UX Researcher

These wireframes are intentionally low-fidelity. They define structure, content hierarchy, and responsive behavior before visual polish.

---

## WF-01 — Marketing Landing Page

**Purpose:** Convert a visitor into a signup.

```text
┌─────────────────────────────────────────────┐
│  Foodcart SaaS        [How it works] [Sign up free]  │  ← sticky nav
├─────────────────────────────────────────────┤
│                                             │
│   Get a polished food-cart website          │
│   in 10 minutes — from your existing links  │
│                                             │
│   [Start free with Google]                  │
│   No credit card. No design skills needed.  │
│                                             │
├─────────────────────────────────────────────┤
│   How it works                              │
│   1. Connect Google, Yelp, Instagram ...    │
│   2. Pick a food-native template            │
│   3. Preview and publish                    │
├─────────────────────────────────────────────┤
│   Template preview strip                    │
│   [Banh Mi] [Real Indian] [Mis Abuelos]     │
├─────────────────────────────────────────────┤
│   Footer                                    │
└─────────────────────────────────────────────┘
```

### Notes
- Mobile: nav collapses to hamburger; CTA becomes a sticky bottom bar after scroll.
- Primary CTA color from `semantic.color.interactive`.

---

## WF-02 — Onboarding: Step 1 Business Identity

**Purpose:** Capture the minimum data needed to reserve a tenant and generate a first-pass site.

```text
┌─────────────────────────────────────────────┐
│  ← Back        Create your site (1 of 5)    │
├─────────────────────────────────────────────┤
│                                             │
│   Tell us about your business               │
│                                             │
│   Business name *                           │
│   [Tacos El Cielo                     ]     │
│                                             │
│   Choose your site address *                │
│   [tacoselcielo    ].foodcartsite.com       │
│   ✅ Available                              │
│                                             │
│   Cuisine / vibe *                          │
│   [Mexican street food ▼]                   │
│                                             │
│   Phone                                     │
│   [(503) 555-0198                      ]    │
│                                             │
│   Timezone *                                │
│   [America/Los_Angeles ▼]                   │
│                                             │
│            [Continue →]                     │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Progress bar at top is labeled and includes current step.
- Slug field validates in real time; error state shows suggestions.
- Required fields marked with `*` and announced via `aria-required`.

---

## WF-03 — Onboarding: Step 2 Connect Links

**Purpose:** Import existing digital presence; provide manual fallback on failure.

```text
┌─────────────────────────────────────────────┐
│  ← Back        Connect your links (2 of 5)  │
├─────────────────────────────────────────────┤
│                                             │
│   We’ll pull in what we can automatically.  │
│                                             │
│   Google Business Profile *                 │
│   [Connect Google Business Profile]         │
│   ✅ Connected — “Tacos El Cielo”           │
│                                             │
│   Other links (optional)                    │
│   Yelp      [https://yelp.com/...      ]    │
│   DoorDash  [https://doordash.com/...  ]    │
│   UberEats  [                          ]    │
│   Grubhub   [                          ]    │
│   Instagram [https://instagram.com/... ]    │
│   Facebook  [                          ]    │
│   TikTok    [                          ]    │
│   Website   [                          ]    │
│   Menu URL  [https://...               ]    │
│                                             │
│   ⚠️ Couldn’t reach Menu URL. Add it        │
│      manually below or skip.                │
│                                             │
│   [Skip for now]  [Continue →]              │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Failed sources show inline warnings with manual fallback; do not block progress.
- Each link input has an associated label and `type="url"` validation.
- Keyboard tab order follows the vertical form layout.

---

## WF-04 — Onboarding: Step 3 Brand Assets

**Purpose:** Upload logo/hero or accept template defaults.

```text
┌─────────────────────────────────────────────┐
│  ← Back        Brand assets (3 of 5)        │
├─────────────────────────────────────────────┤
│                                             │
│   Logo                                      │
│   [ Drag logo here or click to upload ]     │
│   JPG/PNG, max 2 MB                         │
│                                             │
│   Hero image                                │
│   [ Drag image here or click to upload ]    │
│   This appears at the top of your site.     │
│                                             │
│   [Use template photos]  [Continue →]       │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Upload boxes are keyboard accessible and show file name after selection.
- Skip option is explicit to reduce abandonment.

---

## WF-05 — Onboarding: Step 4 Template Selection

**Purpose:** Match owner vibe to one of three reference templates.

```text
┌─────────────────────────────────────────────┐
│  ← Back        Pick a look (4 of 5)         │
├─────────────────────────────────────────────┤
│                                             │
│   Which style matches your cart?            │
│                                             │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│   │  BANH MI │  │ REAL     │  │ MIS      │  │
│   │  FUSION  │  │ INDIAN   │  │ ABUELOS  │  │
│   │          │  │ FOOD     │  │          │  │
│   │ [thumb]  │  │ [thumb]  │  │ [thumb]  │  │
│   │ Bold,    │  │ Warm,    │  │ Family,  │  │
│   │ diagonal │  │ heritage │  │ Mexican  │  │
│   │ energy   │  │ story    │  │ warmth   │  │
│   │ (Select) │  │ (Select) │  │ (Select) │  │
│   └──────────┘  └──────────┘  └──────────┘  │
│                                             │
│   Recommended for Mexican street food:      │
│   ☑ Mis Abuelos                             │
│                                             │
│            [Continue →]                     │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Cards are selectable as a single-choice group (`role="radiogroup"`).
- Default selection based on cuisine/vibe from Step 1; owner can override.
- Thumbnails are decorative; labels describe the style.

---

## WF-06 — Onboarding: Step 5 Preview & Publish

**Purpose:** Validate generated site before going live.

```text
┌─────────────────────────────────────────────┐
│  ← Back        Preview your site (5 of 5)   │
├─────────────────────────────────────────────┤
│                                             │
│   [Mobile ▼]  [Desktop]                     │
│                                             │
│   ┌─────────────────────────────┐           │
│   │  Preview frame              │           │
│   │  ─────────────────────────  │           │
│   │  Tacos El Cielo             │           │
│   │  [OPEN NOW]                 │           │
│   │  Authentic tacos...         │           │
│   │  [Order Online] [View Menu] │           │
│   │  ─────────────────────────  │           │
│   │  Menu • Locations • Story   │           │
│   └─────────────────────────────┘           │
│                                             │
│   Quick edits:                              │
│   [Edit headline] [Edit hours] [Edit menu]  │
│                                             │
│   [Save draft]  [Publish now →]             │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Mobile viewport is the default.
- Quick-edit shortcuts open a focused bottom sheet without leaving onboarding.
- Publish confirmation modal appears on first publish.

---

## WF-07 — Admin Dashboard: Home

**Purpose:** Central place to manage site, edit content, and publish/unpublish.

```text
┌─────────────────────────────────────────────┐
│  ≡  Foodcart SaaS        [?]  [Account ▼]   │
├─────────────────────────────────────────────┤
│                                             │
│  YOUR SITE                                  │
│  ┌─────────────────────────────────────┐    │
│  │  tacoselcielo.foodcartsite.com      │    │
│  │  Status: ● Published                │    │
│  │  [Copy link] [View QR] [Unpublish]  │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  AI ASSISTANT                               │
│  ┌─────────────────────────────────────┐    │
│  │  What do you want to update?        │    │
│  │  [e.g. "Add vegan section..." ] [→] │    │
│  │  Try: "Friday hours to 11pm"        │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  SECTIONS                                   │
│  ┌─────────────────────────────────────┐    │
│  │  Business Info    [Edit >]          │    │
│  │  Hours & Location [Edit >]          │    │
│  │  Menu             [Edit >]          │    │
│  │  Story            [Edit >]          │
│  │  Catering         [Edit >]          │    │
│  │  Contact & Social [Edit >]          │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  RECENT CHANGES                             │
│  • Today, 9:14 am — Hero headline edited    │
│  • Yesterday — Friday hours updated         │
│  [View all changes]                         │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Mobile: navigation becomes a bottom tab bar (Home, Preview, Settings).
- Each section row is a button; focus moves to the editor when opened.
- Recent changes support one-click revert for each entry.

---

## WF-08 — Admin Dashboard: Hours Editor

**Purpose:** Fast, phone-friendly hours management with live status preview.

```text
┌─────────────────────────────────────────────┐
│  ← Hours & Location                         │
├─────────────────────────────────────────────┤
│                                             │
│  Live status preview                        │
│  ┌─────────────────────────────────────┐    │
│  │  ● Open now — closes 9:00 pm        │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  Weekly hours                               │
│  ┌─────────────────────────────────────┐    │
│  │ Mon  [Closed ▼]                     │    │
│  │ Tue  [10:00 am ▼] – [ 9:00 pm ▼]   │    │
│  │ Wed  [10:00 am ▼] – [ 9:00 pm ▼]   │    │
│  │ Thu  [10:00 am ▼] – [ 9:00 pm ▼]   │    │
│  │ Fri  [10:00 am ▼] – [11:00 pm ▼]   │    │
│  │ Sat  [10:00 am ▼] – [11:00 pm ▼]   │    │
│  │ Sun  [10:00 am ▼] – [ 9:00 pm ▼]   │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [Copy Tue to all open days]                │
│                                             │
│  Special hours (next 14 days)               │
│  [+ Add special date]                       │
│                                             │
│  Location                                   │
│  Address  [__________________________]      │
│  Phone    [__________________________]      │
│  Find-us note [e.g. "Pod A, blue cart"]     │
│                                             │
│  [Cancel]  [Save changes]                   │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Day rows are touch-friendly; closed/open toggle reduces taps.
- Copy-across-days is a single action with confirmation.
- Live status preview updates immediately as hours change.

---

## WF-09 — Admin Dashboard: AI Assistant Diff Preview

**Purpose:** Show exactly what an AI suggestion will change before it is applied.

```text
┌─────────────────────────────────────────────┐
│  ← AI Assistant                             │
├─────────────────────────────────────────────┤
│                                             │
│  You asked:                                 │
│  “Add vegan section to menu”                │
│                                             │
│  Summary                                    │
│  • Add new menu category “Vegan”            │
│  • Move “Veggie Tacos” and “Refried Beans”  │
│    from “Sides” into “Vegan”                │
│  • Confidence: High                         │
│                                             │
│  Diff preview                               │
│  ┌─────────────────────────────────────┐    │
│  │  Menu                               │    │
│  │  ─────────────────────────────      │    │
│  │  Tacos                              │    │
│  │    Carne Asada .... $12             │    │
│  │  + Vegan                            │    │
│  │  +   Veggie Tacos .. $11            │    │
│  │  +   Refried Beans . $5             │    │
│  │  Sides                              │    │
│  │  −   Veggie Tacos .. $11            │    │
│  │  −   Refried Beans . $5             │    │
│  └─────────────────────────────────────┘    │
│                                             │
│  [Edit prompt]  [Reject]  [Approve & apply] │
│                                             │
└─────────────────────────────────────────────┘
```

### Notes
- Added/removed/changed items use color + `+`/`-` text; not color alone.
- Approve button is the primary action but is not auto-focused on load.
- Reject is always available and equally visible.

---

## WF-10 — Generated Consumer Site (Single Page)

**Purpose:** Public-facing site that customers see at `slug.foodcartsite.com`.

```text
┌─────────────────────────────────────────────┐
│  LOGO          Menu  Order  Location  Story │
├─────────────────────────────────────────────┤
│  HERO                                       │
│  ● Open now — closes 9pm                    │
│  Tacos El Cielo                             │
│  Authentic Mexican street food...           │
│  [Order Online]  [View Menu]                │
│           [hero image]                      │
├─────────────────────────────────────────────┤
│  MARQUEE / SOCIAL PROOF                     │
│  “Best tacos in Portland” — Yelp            │
├─────────────────────────────────────────────┤
│  MENU                                       │
│  Tacos    Burritos    Sides    Drinks       │
│  [scrollable cards with price + order link] │
├─────────────────────────────────────────────┤
│  ORDER / DIRECT LINKS                       │
│  [Order direct]  [DoorDash]  [UberEats]     │
├─────────────────────────────────────────────┤
│  STORY                                      │
│  Family recipe photo + 2–3 paragraph text   │
├─────────────────────────────────────────────┤
│  LOCATIONS / HOURS                          │
│  Map thumbnail + address + hours grid       │
│  Today: 10am – 9pm  ● Open                  │
├─────────────────────────────────────────────┤
│  CATERING                                   │
│  Packages + inquiry form                    │
├─────────────────────────────────────────────┤
│  CONTACT & SOCIAL                           │
│  Phone • Email • Instagram • Facebook       │
├─────────────────────────────────────────────┤
│  FOOTER                                     │
│  © Tacos El Cielo — Powered by Foodcart     │
└─────────────────────────────────────────────┘
```

### Notes
- Mobile: nav collapses to hamburger; sections stack vertically.
- Each section has an `id` for anchor links.
- Open/closed badge is visible in hero and locations; timezone-aware.
- Menu uses horizontal scroll-snap or accordion depending on template.

---

## Responsive Behavior Summary

| Screen | Onboarding | Dashboard | Consumer Site |
|---|---|---|---|
| Mobile ≤ 640 px | Single-column step layout; sticky primary action | Bottom nav + bottom-sheet editors | Stacked sections; hamburger nav |
| Tablet 641–1024 px | Centered card, max-width 600 px | Two-column summary + sections | Side-by-side hero, 2-col menu grid |
| Desktop ≥ 1025 px | Centered card, max-width 720 px | Full sidebar + main content | Full reference-template layout |

---

## Wireframe Acceptance Criteria

- [ ] All onboarding steps can be completed with a keyboard only.
- [ ] Every interactive element has a visible focus state matching `component.focus-ring`.
- [ ] Preview defaults to mobile viewport.
- [ ] AI assistant diff clearly distinguishes additions, removals, and changes.
- [ ] Consumer site includes all 7 required sections: hero, about/story, menu, locations/hours, catering, contact, social/order links.
