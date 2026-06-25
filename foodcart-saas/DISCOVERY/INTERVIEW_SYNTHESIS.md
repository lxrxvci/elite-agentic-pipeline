# Interview Synthesis — Foodcart SaaS (Week 1)

> **⚠️ Synthesized / hypothesis:** No real customer interviews were conducted. This synthesis merges (a) five baseline simulated conversations that existed in `DISCOVERY/INTERVIEW_NOTES/` and (b) four additional simulated conversations run in this round. All insights are framed as testable assumptions and must be validated with real food-cart/small-restaurant operators before shaping engineering work.

## Methods

- **Baseline review:** 5 simulated interviews captured earlier in discovery.
- **This round:** 4 additional simulated JTBD-style interviews (30–35 min each).
- **Sean Ellis product/market fit question** asked of this-round participants.
- **Template preference test** using three reference designs: Banh Mi Fusion (bold/diagonal), Real Indian Food (warm/heritage), Mis Abuelos (family/Mexican warmth).

### Baseline Interviews (BASE-01 to BASE-05)

| ID | File | Participant | Business |
|---|---|---|---|
| BASE-01 | [INTERVIEW_NOTES/2026-06-24_maria_tacos.md](INTERVIEW_NOTES/2026-06-24_maria_tacos.md) | Maria — Taco Cart Owner | Maria's Tacos, single food cart, Portland, OR |
| BASE-02 | [INTERVIEW_NOTES/2026-06-24_jen_banhmi.md](INTERVIEW_NOTES/2026-06-24_jen_banhmi.md) | Jen — Banh Mi Fusion Owner | Banh Mi Fusion, food cart + brick-and-mortar |
| BASE-03 | [INTERVIEW_NOTES/2026-06-24_raj_curry.md](INTERVIEW_NOTES/2026-06-24_raj_curry.md) | Raj — Indian Food Cart Owner | Real Indian Food, single cart + catering |
| BASE-04 | [INTERVIEW_NOTES/2026-06-24_diego_barbacoa.md](INTERVIEW_NOTES/2026-06-24_diego_barbacoa.md) | Diego — Barbacoa Cart Owner | Mis Abuelos Barbacoa, family-run cart |
| BASE-05 | [INTERVIEW_NOTES/2026-06-24_sam_pizza.md](INTERVIEW_NOTES/2026-06-24_sam_pizza.md) | Sam — Pizza Truck Owner | Slice on Wheels, pizza food truck |

### This Round (SIM-01 to SIM-04)

| ID | File | Participant | Business |
|---|---|---|---|
| SIM-01 | [INTERVIEW_NOTES/maria-santos.md](INTERVIEW_NOTES/maria-santos.md) | Maria Santos | Tacos El Cielo — rotating Mexican food cart |
| SIM-02 | [INTERVIEW_NOTES/kevin-nguyen.md](INTERVIEW_NOTES/kevin-nguyen.md) | Kevin Nguyen | Banh Mi Fusion PDX — fusion cart + storefront |
| SIM-03 | [INTERVIEW_NOTES/priya-patel.md](INTERVIEW_NOTES/priya-patel.md) | Priya Patel | Real Indian Food — Indian cart + catering |
| SIM-04 | [INTERVIEW_NOTES/jordan-blake.md](INTERVIEW_NOTES/jordan-blake.md) | Jordan Blake | Blake's Biscuits — bakery + market cart |

## Participant Snapshot

| Participant | Segment | Tech Comfort | PMF Signal | Evidence |
|---|---|---|---|---|
| Maria — Taco Cart Owner | No website, social-first | Low-medium | High-fit | BASE-01 |
| Jen — Banh Mi Fusion Owner | Fragmented presence | High | High-fit | BASE-02 |
| Raj — Indian Food Cart Owner | No website, catering | Low-medium | High-fit | BASE-03 |
| Diego — Barbacoa Cart Owner | No website, heritage | Low | High-fit | BASE-04 |
| Sam — Pizza Truck Owner | Strong Instagram workflow | Medium | Medium/Low-fit | BASE-05 |
| Maria Santos | No website, social-first | Low-medium | Somewhat disappointed | SIM-01 |
| Kevin Nguyen | Fragmented presence | High | Very disappointed | SIM-02 |
| Priya Patel | No website, catering | Low | Somewhat disappointed | SIM-03 |
| Jordan Blake | Existing Squarespace site | Medium | Not disappointed | SIM-04 |

## Jobs-to-be-Done (Ranked by Frequency)

1. **Be found and look credible** (9/9)
   - Owners want to look as professional as brick-and-mortar restaurants when customers search on phones.
2. **Keep menu and hours accurate everywhere** (8/9)
   - Stale menus on Google, delivery apps, and social media create real customer friction.
3. **Update quickly from a phone** (8/9)
   - Owners rarely sit at a computer; updates happen between shifts or on the go.
4. **Capture catering/event leads** (6/9)
   - Catering is high-margin but currently handled through messy DMs, texts, and phone calls.
5. **Drive direct orders / reduce delivery-app fees** (6/9)
   - 15–30% commission is painful; direct ordering links are a strong economic motivator.
6. **Tell a brand story** (6/9)
   - Heritage/family businesses (Real Indian Food, Mis Abuelos, Tacos El Cielo) want warmth and authenticity.
7. **Trust the tool not to break the live site** (6/9)
   - Preview, approval, and undo are prerequisites for AI-assisted editing.

## Pains (Ranked by Severity)

| Pain | Frequency | Severity | Evidence |
|---|---|---|---|
| No website or outdated site | 7/9 | High | BASE-01, BASE-03, BASE-04; SIM-01, SIM-03, SIM-04 |
| Time/skill to maintain a site | 8/9 | High | Wix/Squarespace abandoned due to complexity (BASE-02, SIM-04) |
| Fragmented info across platforms | 8/9 | High | Google, Yelp, DoorDash, Instagram all out of sync |
| Lost catering leads | 5/9 | High | BASE-01, BASE-03, BASE-04; SIM-01, SIM-03 |
| Wrong hours confuse customers | 6/9 | Medium | Rotating-location carts (BASE-01, BASE-04, SIM-01, SIM-02) |
| Delivery apps own the customer | 5/9 | Medium | 15–30% commission cited (BASE-02, BASE-03, SIM-01, SIM-02) |
| Fear of AI mistakes / loss of control | 4/9 | Medium | BASE-01, BASE-02, BASE-03; SIM-03 |

## Gains

- **Speed:** "Publish in minutes, not hours" resonated with all high-fit prospects.
- **Mobile editing:** Updating from a phone is non-negotiable.
- **AI-assisted updates:** High interest when framed as "draft + approve," not "auto-publish."
- **Food-specific design:** Generic templates felt corporate; owners want warmth, boldness, or heritage (aligned with Banh Mi Fusion, Real Indian Food, Mis Abuelos).
- **Safety/undo:** Fear of breaking the live site was universal; versioning and previews are trust builders.
- **Direct-order analytics:** Tech-comfortable operators want to see click-share by channel.

## Segment Insights

### High-Fit Segment: "Invisible but Ambitious"
- No website or abandoned site.
- Active on social but wants credibility.
- Values time over money.
- Willing to pay ~$25–40/month for convenience.
- **Representatives:** Maria's Tacos, Real Indian Food, Mis Abuelos Barbacoa, Tacos El Cielo.

### Secondary Segment: "Growing Mini-Chain"
- Multiple locations or catering focus.
- Needs consistency and centralized control.
- Higher budget, but demands ROI proof and analytics.
- **Representatives:** Banh Mi Fusion, Banh Mi Fusion PDX.

### Low-Fit Segment (Today): "Social-Native"
- Strong existing Instagram/TikTok workflow.
- Sees a website as redundant unless it drives measurable bookings.
- May convert with event-booking or social-sync features.
- **Representatives:** Slice on Wheels, Blake's Biscuits (currently satisfied with Squarespace).

## Themes

| ID | Theme | Evidence | Confidence |
|---|---|---|---|
| T1 | **Time poverty is universal.** Operators manage the business from a phone, often while cooking or serving. | BASE-01–05, SIM-01–04 | High (synthesized) |
| T2 | **Online presence is fragmented and stale.** Information lives across Instagram, Google, DoorDash, Yelp, and text threads. | BASE-01–05, SIM-01–04 | High (synthesized) |
| T3 | **Direct orders are economically important.** Operators mentioned delivery-app fees or direct margin. | BASE-02, BASE-03, BASE-05, SIM-01, SIM-02, SIM-04 | Medium (synthesized) |
| T4 | **Live hours/location is a trust signal.** Wrong hours/location lead to bad reviews and lost customers. | BASE-01, BASE-02, BASE-04, BASE-05, SIM-01, SIM-02, SIM-03, SIM-04 | High (synthesized) |
| T5 | **Price sensitivity is real; current tools feel overpriced or underused.** | BASE-01, BASE-05, SIM-01, SIM-03, SIM-04 | Medium (synthesized) |
| T6 | **Trust and control are barriers to AI-assisted editing.** Operators want preview + approval. | BASE-01, BASE-02, BASE-03, SIM-02, SIM-03, SIM-04 | Medium (synthesized) |
| T7 | **Brand authenticity matters; one size does not fit all.** Operators self-segmented toward template style. | BASE-01, BASE-03, BASE-04, SIM-01, SIM-02, SIM-03, SIM-04 | High (synthesized) |
| T8 | **Catering is a high-value, poorly supported workflow.** | BASE-01, BASE-03, BASE-04, SIM-01, SIM-03 | Medium (synthesized) |
| T9 | **Mobile editing is a baseline expectation, not a nice-to-have.** | BASE-01, BASE-02, BASE-04, BASE-05, SIM-01, SIM-03, SIM-04 | High (synthesized) |

## Design & Product Implications

1. **Onboarding must be ruthlessly fast.** A 10-minute publish path is a credible competitive advantage.
2. **AI assistant must be a suggestion engine first.** Explicit approval and revert are table stakes for trust.
3. **Mobile dashboard is not a nice-to-have.** Assume all owner edits happen on a phone.
4. **Catering is a hidden revenue lever.** Even solo operators want a simple lead form.
5. **Templates must feel food-native.** The three reference designs map well to owner aesthetic desires.
6. **Live open/closed status and accurate hours** should be visible by default.
7. **Direct-order CTAs and channel analytics** matter for brand-proud, multi-location operators.

## Surprising / Counter-Intuitive Findings

- **AI enthusiasm is segmented, not universal.** Jen/Kevin (tech-comfortable) want it; Raj/Priya (risk-averse) need preview/approval; Jordan/Sam only want it for simple swaps or not at all.
- **Existing website owners are not automatically satisfied.** Jen has Squarespace and Jordan pays for Squarespace, but both use Instagram for daily updates because editors are too slow. "Has a website" ≠ "problem solved."
- **Template preference mapped to cultural identity.** Diego chose Mis Abuelos warmth, Raj/Priya chose Real Indian Food heritage, Jen/Kevin chose Banh Mi Fusion boldness.
- **High-social-follower operators may be lower-fit early prospects.** Sam has 12K Instagram followers and sees limited value unless the site drives new event bookings.

## Open Questions for Next Round

1. What is the actual willingness-to-pay distribution across segments?
2. How often do owners realistically update their sites after the first week?
3. Do customers actually visit cart websites, or do they rely entirely on Google/maps?
4. Which template style converts best for which cuisine type?
5. How much does live open/closed status affect visit/click behavior?
6. How important is bilingual support (Spanish, Chinese, Vietnamese) for owners and customers?

## Evidence Traceability

| Evidence ID | Source | Themes / Opportunities Influenced |
|---|---|---|
| BASE-01 | [INTERVIEW_NOTES/2026-06-24_maria_tacos.md](INTERVIEW_NOTES/2026-06-24_maria_tacos.md) | T1, T2, T4, T5, T6, T7, T8, T9; O1, O2, O4, O5, O6 |
| BASE-02 | [INTERVIEW_NOTES/2026-06-24_jen_banhmi.md](INTERVIEW_NOTES/2026-06-24_jen_banhmi.md) | T1, T2, T3, T4, T6, T9; O1, O2, O3, O6, O7, O8 |
| BASE-03 | [INTERVIEW_NOTES/2026-06-24_raj_curry.md](INTERVIEW_NOTES/2026-06-24_raj_curry.md) | T1, T2, T3, T4, T6, T7, T8; O1, O2, O3, O5, O6, O7 |
| BASE-04 | [INTERVIEW_NOTES/2026-06-24_diego_barbacoa.md](INTERVIEW_NOTES/2026-06-24_diego_barbacoa.md) | T1, T2, T4, T7, T8, T9; O1, O2, O5, O6 |
| BASE-05 | [INTERVIEW_NOTES/2026-06-24_sam_pizza.md](INTERVIEW_NOTES/2026-06-24_sam_pizza.md) | T1, T2, T3, T5, T9; O1, O3, O10 |
| SIM-01 | [INTERVIEW_NOTES/maria-santos.md](INTERVIEW_NOTES/maria-santos.md) | T1, T2, T4, T5, T7, T8, T9; O1, O2, O4, O5, O6 |
| SIM-02 | [INTERVIEW_NOTES/kevin-nguyen.md](INTERVIEW_NOTES/kevin-nguyen.md) | T1, T2, T3, T4, T6, T7, T9; O1, O2, O3, O6, O7, O8, O10 |
| SIM-03 | [INTERVIEW_NOTES/priya-patel.md](INTERVIEW_NOTES/priya-patel.md) | T1, T2, T4, T5, T6, T7, T8, T9; O1, O4, O5, O6, O7, O9 |
| SIM-04 | [INTERVIEW_NOTES/jordan-blake.md](INTERVIEW_NOTES/jordan-blake.md) | T1, T2, T3, T5, T6, T7, T9; O1, O2, O3, O4, O6, O10 |
