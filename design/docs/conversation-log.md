# Conversation log: Campus Pickup UI design (30 Sep – 7 Oct 2026)

A written record of the design sessions: what was asked, what was built, the decisions and why. The full raw transcript is in `chat-transcript-2026-10-07.zip` next to this file.

## Session 1: first UI design (30 Sep)

**Ask:** Read the build plan (`build-plan-v1.md`) and design the iOS UI first. Very interactive and intuitive, with 3D components, and it must not look AI-generated. Look at threeui.com, tasteskill.dev, gsap.com and 21st.dev, research the best UI tools and skills, and use Apple's product pages as the quality bar.

**What happened:**
- A research agent reviewed the four sites, the React Native 3D and motion tools, and reference apps → `research/01-ui-tools-and-references.md`.
- Finding: all four sites are web-only, and none can be reused in Expo. tasteskill.dev is useful as a review checklist.
- Chose the **"Floodlight"** direction, based on a LUMS ground at 7pm: turf, chalk lines, a red-taped tennis ball, floodlights.
  - Rejected the default sports-app look (dark background with neon green) and the usual AI tells (purple gradients, glass cards, Inter, emoji icons).
- Built an interactive prototype and published it as a private Claude artifact:
  - a 3D campus map (three.js) with a time slider that changes the lighting and turns on the floodlights;
  - pins showing spots left;
  - a game sheet with a 120pt count and a pitch formation;
  - join with an avatar flying into its slot, a live join from another player, and a push banner;
  - Start a game, chat with an expiry notice, report menu, campus email verification.
- Stack decision after research: use **react-native-filament** for real 3D. react-three-fiber/native has expo-gl version clashes. The 3D campus in the real app comes from **MapLibre** (pitch plus `fill-extrusion`), not three.js.
- Bugs found in browser testing and fixed:
  - the camera started too close;
  - pin labels ran off the screen edge;
  - the pitch formation collapsed to zero height (flex shrink).

## Session 2: more screens and US university research (30 Sep)

**Ask:** More screens, more innovation. Learn from how Harvard, MIT, Cornell, Duke, Brown and similar schools handle these events. Build for one university first, then scale to others. What else can we build on top?

**What happened:**
- A second research agent covered Yale, Princeton, Duke and Harvard house cups, IMLeagues operations, pickup apps, Facebook/Fizz/Yik Yak campus rollouts, and Pakistan specifics → `research/02-us-universities-and-growth.md`.
  - MIT and Brown details couldn't be verified, so nothing is based on them.
- Added a tab bar (Map, Your games, Hostel Cup, You) and these screens:
  - **Game day:** check-in ring → Orange/Green bib teams → 3D Rs 5 coin toss → ball-by-ball tape-ball or football scoring, mirrored live on the map pin → match card, fair-play question, "play again next week".
  - **Your games:** "I'm free to play" toggle, positions, weekly availability grid, upcoming games, Regulars.
  - **Hostel Cup:** 3D podium and trophy, standings, Night Series bracket, points rules. Finishing a game adds points.
  - **You:** 3D-tilt player card, notification toggles, blocked people, delete account.
  - **New campuses:** waitlist progress per campus.
  - **Conditions strip** on the map (prayer time, AQI, temperature) and "Repeat every week" in Start a game.
- Decisions:
  - Cup points reward turning up over winning (+10 play vs +5 win), plus +50 for the most different players (Princeton). Drop-out 2+ h before kick-off is free and a no-show is −10 (IMLeagues "default" rule).
  - A campus unlocks at **10%** of students on the waitlist plus **two campus leads** who've run the WhatsApp pilot for two weeks. Facebook used about 20%. Lower here because only players need density.
  - **Nothing new goes into the seven-week v1.** Features are phased v1.1 / Phase 2 / Phase 3 / Later, each gated on the plan's go/no-go metrics.
  - All four safety rules are kept. Check-in verifies location once and then discards it, and live scores show team colours, not people.
  - Revenue later comes from ground booking with the sports office, not ads.
- Bugs found in browser testing and fixed:
  - the standings row clashed with an existing `.me` CSS class;
  - the coin face was rotated 90°;
  - the toss label overlapped the coin;
  - pages showed on the wrong tab because the `[hidden]` rule was missing.

## Session 3: saving the work (7 Oct)

**Ask:** Save everything before losing the Claude account.

**What happened:**
- Saved to `~/dev/campus-pickup` (local git) with a handoff README, the prototype, the research, the plan and the transcript export.
- Pushed to `abdurrehman-haroon/join_me` as maliawan0 on branch `design/floodlight-prototype`, as PR #1 into `main`. Files are under `design/`.
- The raw transcript was first kept out because the repo is public. At the user's request it was added after a scan found no tokens or keys.

## Open questions / next steps
1. Which screens to refine before building.
2. Set up the Expo project (dev build), commit and extend `openapi.yaml`, and build v1 screens against a mock server (week 1 of the plan).
3. Confirm the real LUMS hostel names and ground names. The prototype uses placeholders (M-1…M-6, F-1…F-3, "Sports Complex turf", etc.).
4. Check with SLUMS about a pilot partnership and the campus-lead role.
