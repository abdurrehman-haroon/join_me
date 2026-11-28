# How we build

The user's way of building features. Follow it for every feature, alongside docs/ai.md.

## 1. One piece at a time
- Split a feature into numbered points (1, 2, 3…) and build them in order. Never build ahead of the point in hand.
- Discuss before building. Nothing is built until the user says so.
- Ideas that come up but aren't for now go on a parked list (with where they'd belong), not into the current work.

## 2. Discussing a design
- Lay out the flow in plain words, then numbered decisions. Give options with a recommendation marked "my pick".
- The user answers by number ("1 A, 2 sure, 3 B"). Anything they don't answer, take the recommendation.
- If an answer is unclear, say how it was read and carry on; don't stall.
- Ask only what's genuinely theirs to decide. Check facts in the code yourself.

## 3. Schema and contract proposals
- Before building, propose the full contract in this layout:
  Database (enums, columns, indexes, migration name) · API · The app · Tracking · Deploy checklist · Questions.
- Repeat the whole proposal every turn, with changes marked [changed], [new] or [removed], and answered questions removed, until the user says "finalize".
- After finalizing, build exactly that. Any difference found while building (a fact the plan missed) is stated plainly in the report, with the reason.

## 4. Building
- Split big points into slices, each one testable on the phone, and get a go before each slice.
- Match the app's theme: the Explore palette and fonts (`explore` in `frontend/src/ExploreCards.tsx`).
- Every feature gets tracking agreed during discussion (see docs/activities.md).
- Anything off or temporary until deployment goes in docs/deploy-checklist.md.

## 5. Checking on the phone
- Build a release build (not debug), install it on the user's phone and walk every path: the happy path, edge cases, limits and errors.
- Check the database too: the rows created and every tracking row.
- Fix bugs found while testing, rebuild and check again. Say which bugs were found and fixed.
- Report what was not checked. Never call something done without seeing it on the device.
- When the user says "be autonomous", test everything end to end without asking, and report at the end.

## 6. Reporting
- Short and plain: what works (with what was seen), what was fixed, what was left behind (test data, limits used), and what's next.
- Leave everything uncommitted for review.
