# Usability Test Plan — Foodcart SaaS Cycle 1

> **Stage:** Design & Build — Design Discovery  
> **Owner:** UX Designer (paired with UX Researcher)  
> **Goal:** Validate the core flows of Cycle 1 with target users before engineering handoff and again after first build.

---

## 1. Test Objectives

| Objective | How Measured |
|---|---|
| Onboarding can be completed in < 10 minutes | Task time + success rate |
| Owners understand and trust the AI assistant preview/approval flow | Acceptance/rejection ratio + qualitative feedback |
| Mobile dashboard lets owners update hours in < 60 seconds | Task time + error rate |
| Owners can preview and publish/unpublish confidently | Completion rate + System Usability Scale (SUS) |
| Template selection feels authentic to the business | Brand-match rating + qualitative rationale |

---

## 2. Participant Profile

Recruit **5–7 food-cart or small-restaurant operators** matching our primary and secondary personas:

- **Primary:** Solo cart owners with no website or an abandoned one (Maria-like).
- **Secondary 1:** Multi-location or brand-proud operators (Kevin-like).
- **Secondary 2:** Heritage-focused caterers (Priya-like).

### Screener Questions
1. Do you currently own or operate a food cart, food truck, or small restaurant?
2. Do you have a website today? (Yes / No / Outdated or abandoned)
3. How do customers usually find your hours and menu? (Google, Instagram, DoorDash, word of mouth, etc.)
4. Have you used a website builder before? (Wix, Squarespace, Linktree, etc.)
5. Are you comfortable testing on your phone?

---

## 3. Test Sessions

| Attribute | Detail |
|---|---|
| **Format** | Moderated remote or in-person; owner uses their own phone + optional desktop |
| **Duration** | 45–60 minutes |
| **Compensation** | $50–75 gift card or meal credit |
| **Artifacts** | Prototype (Figma, CodeSandbox, or clickable wireframe), observation sheet, post-task survey |

---

## 4. Tasks & Scenarios

### Task 1 — Onboarding & Publish (15 min)

**Scenario:** “You’ve heard about a tool that builds a website from your existing links. Your business is called [participant’s business]. Please sign up and get your site live as fast as you can.”

**Steps observed:**
1. Sign up / log in.
2. Enter business identity and slug.
3. Connect or manually enter at least one link.
4. Pick a template.
5. Preview the generated site.
6. Publish.

**Success criteria:**
- Completes all steps without moderator help.
- Time to publish < 10 minutes.
- Can articulate what their public URL is.

**Post-task question:** “On a scale of 1–5, how well does the generated site match your brand?”

---

### Task 2 — Update Hours from Phone (10 min)

**Scenario:** “It’s Friday morning and you just decided to stay open until 11pm tonight. Update your hours using only your phone.”

**Steps observed:**
1. Navigate to Hours & Location in dashboard.
2. Change Friday closing time to 11pm.
3. Save and preview.

**Success criteria:**
- Completes update in < 60 seconds.
- Live open/closed badge reflects the change.
- No accidental changes to other days.

**Post-task question:** “How confident are you that customers will see the correct hours?”

---

### Task 3 — AI Assistant Edit (15 min)

**Scenario:** “You want to add a vegan section to your menu. Use the AI assistant to do it.”

**Steps observed:**
1. Open AI assistant.
2. Type request.
3. Review diff preview.
4. Approve or reject.
5. Preview the result.

**Success criteria:**
- Diff preview is understood before approving.
- Approves only if the suggestion looks correct.
- Can explain what changed.

**Post-task questions:**
- “Did the AI do what you expected?”
- “How safe did you feel approving the change?”

---

### Task 4 — Preview & Unpublish (10 min)

**Scenario:** “You noticed a typo on your live site. Make a quick edit, preview it, then take the site down temporarily.”

**Steps observed:**
1. Edit headline or business info.
2. Open preview in mobile viewport.
3. Unpublish site.
4. Confirm public URL shows 404 or closed message.

**Success criteria:**
- Preview clearly distinguishes draft from live site.
- Unpublish action is intentional (not accidental).
- Understands how to re-publish.

---

## 5. Metrics

### Quantitative

| Metric | Target | Source |
|---|---|---|
| Onboarding task success rate | 100% (with or without minor prompts) | Observation |
| Median time to publish | < 10 min | Timer |
| Mobile hours update time | < 60 s | Timer |
| AI suggestion approval without rework | ≥ 80% | Event log + observation |
| SUS score | ≥ 70 | Post-test survey |
| Brand-match rating (1–5) | ≥ 3.5 average | Post-task survey |

### Qualitative

- Moments of confusion or hesitation.
- Language participants use to describe their business/site.
- Trust signals or concerns about AI.
- Template preference rationale.
- Feature requests or missing expectations.

---

## 6. Test Materials

### Prototype Requirements
- Clickable low- or mid-fidelity prototype of onboarding, dashboard, preview, and AI assistant.
- At least one template rendered in preview mode.
- Fake ingestion results (simulate Google Business Profile import).

### Data Capture Sheet
Fields per task: start time, end time, errors, help required, notes, completion (success/partial/fail).

### Post-Test Survey (5 min)
1. System Usability Scale (10 items).
2. “Would you use this to manage your real site?” (Yes / Maybe / No — why).
3. “What was the best part?”
4. “What was the worst part?”
5. “What would you change before launch?”

---

## 7. Session Script Outline

1. **Intro & consent** (3 min)
2. **Background questions** (5 min)
3. **Task 1 — Onboarding & publish** (15 min)
4. **Task 2 — Update hours** (10 min)
5. **Task 3 — AI assistant edit** (15 min)
6. **Task 4 — Preview & unpublish** (10 min)
7. **Post-test survey** (5 min)
8. **Debrief & thank you** (2 min)

---

## 8. Analysis & Reporting

After all sessions:

1. Compile task times and success rates.
2. Tag qualitative notes by theme (trust, speed, confusion, delight).
3. Identify top 3 usability blockers.
4. Produce 1-page findings report with recommendations.
5. Prioritize fixes with Product Owner and Tech Lead before build / before launch.

---

## 9. Timeline

| Milestone | Target Date |
|---|---|
| Recruit participants | Week 1 of Cycle 1 |
| Run prototype tests | Week 2–3 |
| Synthesize findings | End of Week 3 |
| Iterate designs | Week 4 |
| Re-test critical fixes | Week 5 |
| Hand off validated specs | Week 6 |

---

## 10. Risk & Assumptions

- **Risk:** Difficult to recruit real cart owners quickly.  
  *Mitigation:* Offer higher incentive; partner with local food-cart pods; allow remote sessions.
- **Risk:** Prototype fidelity is too low to test trust in AI.  
  *Mitigation:* Use realistic diff preview content; explain it is a simulation.
- **Risk:** Participants have widely different tech comfort.  
  *Mitigation:* Over-recruit by 2 participants; segment analysis by tech comfort.

---

## 11. Post-Launch Usability Round (Observe & Improve)

> **Goal:** Validate the live product and Cycle 2 AI assistant with real operators after Cycle 1 release.  
> **Owner:** UX Researcher  
> **When:** Weeks 2–4 of post-launch research sprint.  
> **Participants:** 5 real food-cart or small-restaurant operators recruited via the [Post-Launch Research Plan](../DISCOVERY/POST_LAUNCH_RESEARCH_PLAN.md).

### Post-Launch Test Objectives

| Objective | How Measured |
|---|---|
| Live onboarding can still be completed in < 10 minutes on a real phone | Task time + success rate |
| Owners trust the AI assistant diff preview and revert path | SUS + trust rating + qualitative feedback |
| Mobile hours update propagates to the live open/closed badge | Task time + accuracy check |
| Owners can recover from an unwanted change with one-click revert | Success rate + time to revert |
| Real operators would be "very disappointed" if the product disappeared | Sean Ellis PMF survey |

### Post-Launch Tasks & Success Metrics

#### Task P1 — Live Onboarding & First Publish

**Scenario:** *"You just signed up for Foodcart SaaS on your phone. Build and publish your site as fast as you can."*

**Steps:**

1. Sign up / log in with Clerk.
2. Enter business identity and slug.
3. Connect or manually enter existing links.
4. Pick (or accept) a template.
5. Preview the generated site on mobile.
6. Publish.

**Success metrics:**

- Completes all steps without moderator takeover.
- Median time to publish < 10 minutes.
- Brand-match rating ≥ 3.5/5.
- Can articulate public URL.

---

#### Task P2 — AI Assistant Menu Edit

**Scenario:** *"You want to add a vegan section to your menu. Use the AI assistant to propose the change, then approve it."*

**Steps:**

1. Open AI assistant from the dashboard.
2. Type: "Add a vegan section to the menu."
3. Review the diff preview.
4. Approve.
5. Preview the live result.

**Success metrics:**

- Diff preview understood before approving ≥ 80%.
- Approval without rework ≥ 80%.
- Participant can explain what changed.
- SUS ≥ 70; trust/safety rating ≥ 70.

---

#### Task P3 — AI Assistant Hours Edit + Revert

**Scenario:** *"You asked the AI to update Friday hours to 11pm, but you changed your mind. Make the update, then undo it."*

**Steps:**

1. Request hours change via AI assistant.
2. Approve the change.
3. Preview the site.
4. Revert the change from version history.

**Success metrics:**

- Revert completed in < 30 seconds.
- Site reflects revert within 5 seconds of confirmation.
- 100% success rate.

---

#### Task P4 — Mobile Hours Update + Verify Live Badge

**Scenario:** *"It's Friday morning and you just decided to stay open until 11pm tonight. Update your hours on your phone and confirm customers see it."*

**Steps:**

1. Open Hours & Location on mobile dashboard.
2. Change Friday closing time to 11pm.
3. Save and preview.
4. Open public site and check open/closed badge.

**Success metrics:**

- Update completed in < 60 seconds.
- Live badge reflects change accurately.
- No accidental changes to other days.

---

#### Task P5 — Unpublish / Republish Confidence

**Scenario:** *"You noticed a typo on your live site. Take the site down temporarily, then put it back up."*

**Steps:**

1. Unpublish site.
2. Confirm public URL shows 404 or "coming soon."
3. Re-publish.

**Success metrics:**

- Unpublish is intentional (confirmation understood).
- Republish completes successfully.
- Participant understands draft vs. live distinction.

### Post-Launch Quantitative Targets

| Metric | Target | Source |
|---|---|---|
| Live onboarding task success rate | 100% (with or without minor prompts) | Observation |
| Median time to publish | < 10 min | Timer |
| AI diff comprehension | ≥ 80% explain correctly before approving | Observation |
| AI approval without rework | ≥ 80% | Event log + observation |
| Revert success rate | 100% | Observation |
| Mobile hours update time | < 60 s | Timer |
| SUS score | ≥ 70 | Post-test survey |
| Trust/safety rating (1–5) | ≥ 3.5/5 (≥ 70% "safe") | Post-test survey |
| Brand-match rating (1–5) | ≥ 3.5/5 | Post-task survey |

### Post-Launch Qualitative Focus

- Moments of confusion or hesitation on the live product.
- Language participants use to describe the AI diff preview.
- Trust signals or concerns about AI making live changes.
- Whether the live open/closed badge matches their mental model.
- Template selection: did they know which one fit their brand?
- Missing expectations or feature requests.

### Post-Launch Session Script

1. **Intro & consent** (3 min)
2. **Background & JTBD questions** (10 min)
3. **Task P1 — Live onboarding & publish** (15 min)
4. **Task P4 — Mobile hours update** (10 min)
5. **Task P2 — AI assistant menu edit** (10 min)
6. **Task P3 — AI hours edit + revert** (10 min)
7. **Task P5 — Unpublish / republish** (5 min)
8. **Sean Ellis PMF question + SUS survey** (5 min)
9. **Debrief & thank you** (2 min)

*Total: ~70 min. Adjust on the fly for participant schedule.*

### Post-Launch Analysis

After all sessions:

1. Compile task times and success rates.
2. Tag qualitative notes by theme: trust, speed, confusion, delight, AI comprehension.
3. Identify top 3 usability blockers.
4. Update `DISCOVERY/INTERVIEW_SYNTHESIS.md` and `DISCOVERY/OST.md` with findings.
5. Feed prioritized fixes into `BACKLOG.md` for Cycle 2/3.
