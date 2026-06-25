# Post-Launch Research Plan — Foodcart SaaS

> **Stage:** Observe & Improve  
> **Owner:** UX Researcher (paired with Product Strategist and UX Designer)  
> **Goal:** Validate the riskiest post-launch assumptions with real food-cart and small-restaurant operators, feed insights back into the OST and backlog, and establish a product/market fit baseline.

## Research Questions

1. Do real operators complete onboarding and publish in under 10 minutes without help?
2. Do operators trust and use the AI Website Assistant (preview / approve / revert)?
3. Does the live open/closed badge and accurate hours drive customer action?
4. Which template style do operators prefer, and does a smart default or quiz reduce friction?
5. How disappointed would operators be if Foodcart SaaS disappeared? (Sean Ellis)

## Methods

| Method | Participants | Timing | Output |
|---|---|---|---|
| Real owner interviews | 5 | Weeks 1–2 | `DISCOVERY/INTERVIEW_NOTES/`, updated personas/job stories |
| Onboarding usability test (live product) | 5 (overlap with interviews) | Weeks 2–3 | Task success rates, time-to-publish, qualitative blockers |
| AI assistant usability test | 5 | Weeks 2–3 | SUS, trust rating, comprehension errors |
| Sean Ellis PMF survey | ≥ 30 published / early-access owners | Weeks 3–4 | PMF score by segment |

## Participant Profile

Recruit **5 real food-cart, food-truck, or small-restaurant owners/operators** who match the ICP:

- **3 solo operators** with no website or an outdated/abandoned one (Maria-like).
- **1 multi-location or brand-proud operator** (Kevin-like).
- **1 heritage/catering-focused operator** (Priya-like).

### Screener

1. Do you currently own or operate a food cart, food truck, or small restaurant?
2. Do you have a website today? (Yes / No / Outdated or abandoned)
3. How do customers usually find your hours and menu?
4. Have you used a website builder? Which one? Why did you stop?
5. Are you comfortable testing on your phone?
6. Would you be willing to let us observe you using a new tool and answer follow-up questions? (45–60 min)

### Recruitment Channels

- Local food-cart pods and market managers (Portland, Austin, Los Angeles).
- Instagram/Facebook outreach via `#foodcart` and city hashtags.
- Partnerships with commercial kitchen commissaries.
- **Incentive:** $60–100 gift card or meal credit per session.

## JTBD Interview Protocol (30 min)

1. **Context:** Tell me about your cart/restaurant and a typical day.
2. **Findability:** How do new customers discover you? Walk me through the last time someone found you online.
3. **Updates:** When something changes (menu, hours, sold out), how do you update customers today?
4. **Tools:** What have you tried for a website? What worked / didn't?
5. **Value:** If you had a simple, mobile-updatable website, what would success look like for you?
6. **Catering:** How do catering/event inquiries reach you today?
7. **Closing:** Sean Ellis PMF question.

## Sean Ellis Product/Market Fit Survey

**Question:** *How would you feel if you could no longer use Foodcart SaaS?*

- Very disappointed
- Somewhat disappointed
- Not disappointed (it isn't really that useful)
- I no longer use it

**Follow-up (if disappointed):** What is the primary benefit you get from Foodcart SaaS?

**Follow-up (if not disappointed):** What would need to change for you to be "very disappointed"?

**Distribution:** In-app after publish (day 7) + email to early-access ring.

**Analysis:**

- PMF threshold: ≥ 40% "very disappointed" overall.
- Segment by: segment (solo vs mini-chain), template chosen, AI usage, catering leads received.
- Qualitatively code open responses into JTBD themes.

## Usability Tests

Use the live Foodcart SaaS onboarding flow on the participant's phone. Detailed post-launch tasks, scenarios, and success metrics are in [design/USABILITY_TEST_PLAN.md](../design/USABILITY_TEST_PLAN.md) §11.

### Test 1 — Live Onboarding & First Publish

**Scenario:** *"You just heard about a tool that builds a website from your existing links. Please sign up and get your site live as fast as you can."*

**Tasks:**

1. Sign up with your email / Clerk.
2. Enter business identity and slug.
3. Connect or manually enter at least one link (Google, Yelp, DoorDash, Instagram, etc.).
4. Pick a template.
5. Preview the generated site.
6. Publish.

**Success metrics:** task success rate 100% (with minor prompts), median time to publish < 10 min, brand-match rating ≥ 3.5/5, can articulate public URL.

### Test 2 — AI Website Assistant

**Scenario:** *"You want to add a vegan section to your menu and later change Friday hours to 11pm. Use the AI assistant."*

**Tasks:**

1. Open the AI assistant.
2. Request a menu change.
3. Review the diff preview.
4. Approve or reject.
5. Preview the live result.
6. Revert the change.

**Success metrics:** understands diff before approving ≥ 80%, approval without rework ≥ 80%, SUS ≥ 70, trust/safety rating ≥ 70, revert success 100%.

### Test 3 — Mobile Hours Update + Verify Badge

**Scenario:** *"It's Friday morning and you decided to stay open until 11pm tonight. Update your hours on your phone and check that customers will see it."*

**Success metrics:** update completed < 60 s, public open/closed badge reflects change, no accidental changes to other days.

## Data Capture

- Screen/audio recording with consent.
- Observer notes sheet: start/end times, errors, help required, quotes.
- Post-task surveys: SUS, brand-match rating (1–5), trust rating (1–5), confidence in hours accuracy.
- Raw notes in `DISCOVERY/INTERVIEW_NOTES/`.

## Analysis & Deliverables

| Week | Activity | Deliverable |
|---|---|---|
| 1 | Recruit + run 2 interviews | Raw notes |
| 2 | Run remaining interviews + onboarding tests | Raw notes + initial synthesis |
| 3 | AI assistant tests + Sean Ellis launch | Usability metrics + survey responses |
| 4 | Synthesize and feed into OST/backlog | Updated `DISCOVERY/INTERVIEW_SYNTHESIS.md`, `DISCOVERY/OST.md`, `BACKLOG.md` recommendations |

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Hard to recruit real owners quickly | Higher incentive, partner with pods, remote sessions allowed |
| AI assistant not yet in GA | Test behind `ai-assistant-v1` flag with a working prototype; if unavailable, test diff-preview prototype |
| Owners have very different tech comfort | Over-recruit by 1; segment analysis by comfort |

## Links

- [design/USABILITY_TEST_PLAN.md](../design/USABILITY_TEST_PLAN.md) — Cycle 1 baseline tasks and post-launch addendum.
- [DISCOVERY/ASSUMPTIONS.md](ASSUMPTIONS.md) — assumptions this plan validates.
- [DISCOVERY/OST.md](OST.md) — opportunities to update with findings.
