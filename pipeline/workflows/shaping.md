# Workflow: Shaping & Betting

## Purpose

Define rough-but-bounded solutions before committing engineering capacity. Inspired by Basecamp's Shape Up.

## Trigger

- A validated opportunity from the OST is ready for build consideration.

## Participants

- Product Strategist (lead)
- Tech Lead
- Product Owner

## Steps

1. **Define the problem**
   - Reference the opportunity and evidence from `DISCOVERY/OST.md`.
   - Write a one-paragraph problem statement.

2. **Shape the solution**
   - Product Strategist outlines the solution at the right level of abstraction: concrete enough to evaluate, rough enough for the team to own details.
   - Define the appetite: how much time is worth spending?
   - Identify rabbit holes and no-gos.

3. **Feasibility review**
   - Tech Lead identifies technical risks, dependencies, and unknowns.
   - Decide: build, spike, or defer.

4. **Write the shaped bet**
   - Product Strategist captures the shaped bet in `docs/SHAPED_BETS.md` with:
     - Problem
     - Appetite
     - Solution sketch
     - Rabbit holes
     - No-gos
     - Success criteria

5. **Betting table**
   - Product Owner evaluates against capacity and roadmap.
   - Product Strategist decides whether to bet on it for the next cycle.

## Exit criteria

- `docs/SHAPED_BETS.md` updated by Product Strategist
- Decision: bet, spike, or pass
- If bet: hand off to RFC/ADR workflow

## Frequency

Per planning cycle (e.g., every 2–6 weeks depending on team size).
