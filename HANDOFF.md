# Campus Pickup: handoff

Everything from the design sessions of 30 Sep – 7 Oct 2026, saved so a new Claude account (or a person) can pick up where we stopped.

## What's in this folder
| Path | What it is |
|---|---|
| `prototype/index.html` | **The interactive prototype.** Double-click to open in a browser. Needs internet (it loads three.js from cdnjs and the Big Shoulders font from Google Fonts). |
| `prototype/campus-pickup-ui.source.html` | The same page without the `<html>/<head>/<body>` wrapper. This is the format the Claude Artifact tool publishes. Republish this file to get a shareable link on the new account. |
| `docs/build-plan-v1.md` | The original build plan (seven weeks, one campus, the go/no-go targets). Still the source of truth for scope. |
| `docs/conversation-log.md` | Session-by-session record of what was asked, built and decided, including the bugs fixed. |
| `research/01-ui-tools-and-references.md` | Round 1: the four sites, the RN 3D/motion toolkit, reference apps, anti-AI-look rules. |
| `docs/chat-transcript-2026-10-07.zip` | Full export of the original chat, including the research agents' transcripts. |
| `research/02-us-universities-and-growth.md` | Round 2: Yale, Princeton, Duke, Harvard, IMLeagues, pickup apps, Facebook/Fizz/Yik Yak, Pakistan specifics. |

The old artifact link (claude.ai/artifact/AX6p7DahvZqeopRb1RSS6c) belongs to the old account and stops working when that account goes.

## The product (one paragraph)
A live map of pickup football and tape-ball cricket games on one Pakistani campus (LUMS first). Two engineers, seven weeks. Go + Postgres/PostGIS backend, React Native + Expo iOS client, MapLibre with self-hosted tiles. The question v1 answers: do games organised in the app actually get played? See `docs/build-plan-v1.md`.

## Design direction: "Floodlight"
Built from what's on a LUMS ground at 7pm: mown turf, chalk lines, a tennis ball wrapped in red tape, floodlights coming on.

- **Palette:** Turf `#1D5B3A` · Chalk `#F4F5F0` · Ink `#15201B` · Tape red `#E3342F` (used only for actions: spots left, join, start a game) · Floodlight `#FFE3A0` · Dusk `#1A2540`
- **Type:** Big Shoulders Display (Google Fonts) for numbers, ground names and titles. SF Pro for everything else.
- **Principles:**
  1. The number is the headline: "4 spots left" at 120pt.
  2. The campus is a place: a tilted 3D model lit for the hour you scrub to.
  3. The controls stay quiet: chalk and ink only, no gradients, no frosted glass, no emoji.
  4. Every action gets a response: you drop into a formation slot, the count rolls down, a haptic fires.
- **Avoided on purpose:** dark background with neon green, purple gradients, glass cards over the map, Inter, identical card grids.

## Screens in the prototype
**v1 (the seven-week build):** live 3D map with a time slider and sport filter · game sheet with the big count, pitch formation, join/leave, live roster, report menu · Start a game (sport, ground, kick-off, players, visibility, repeat weekly) · game chat that closes 2h after kick-off · campus email verification · push notification banner.

**Next (roadmap):** Game day (check in → bib teams → 3D Rs 5 coin toss → live ball-by-ball tape-ball or football score shown on the map pin → match card + fair-play question) · Your games (I'm free to play, positions, weekly availability grid, Regulars) · Hostel Cup (3D podium, standings, Night Series bracket, points rules) · Player card (3D tilt) · New campuses (waitlist progress) · conditions strip on the map (prayer time, AQI, temperature).

## Hostel Cup rules (as designed)
Play in a game that happens +10 · Host a game that happens +15 · Bring kit +3 · Win +5 · Most different players this week +50 · Drop out 2+ h before kick-off 0 · No-show −10. A game only counts once most players have checked in.

## Roadmap (nothing moves into the seven weeks)
- **v1.1, after the plan's four-week go/no-go is met:** Regulars · "I'm free to play" pings (max 1/day) · penalty-free drop-out · conditions strip.
- **Phase 2, once there are enough games:** game-day check-in (one-time location check, then discarded) · teams/toss/live score · match card sharing · fair-play check · Hostel Cup · player card (replaces the Host Reliability Index).
- **Phase 3, second campus:** waitlist unlock at 10% of students + 2 campus leads running the WhatsApp pilot for 2 weeks · campus lead kit · SLUMS society fixtures · first-year ladder · Ramadan mode · Android.
- **Later, revenue:** ground booking with the sports office, then inter-campus friendlies and sponsored kit. The map stays free.

The four safety rules from the plan still hold for every feature: visibility in SQL, the women-only test written first, keep the moderation log, pins are places never people.

## Recommended React Native stack for the UI
Reanimated 4 + Gesture Handler · `@gorhom/bottom-sheet` (snap points 62% / 78%) · `@shopify/react-native-skia` for the formation, pins and digit roll · `react-native-filament` for real 3D moments · Rive for sport icons · Moti for simple transitions · `expo-haptics` (medium on join, warning on last spot, heavy + success on pin drop). The 3D campus in the real app comes from MapLibre: a 55° pitch, `fill-extrusion` buildings from a campus GeoJSON, chalk-textured ground polygons, and a day/night style swap. The three.js scene in the prototype only stands in for it. Avoid react-three-fiber/native and Spline for now.

## Where we stopped / next steps
1. The user reviews the prototype and picks which screens to refine.
2. Then: set up the Expo project (a dev build, not Expo Go), commit `openapi.yaml`, and start building the real v1 screens against a mock server, per week 1 of the plan.

## Prompt to paste into the new account
> I'm continuing a project called Campus Pickup. Read `~/dev/campus-pickup/HANDOFF.md` first, then `docs/build-plan-v1.md` and the two files in `research/`. The prototype is `prototype/index.html`. Keep the "Floodlight" design direction and the roadmap phasing. Next step: [what you want].
