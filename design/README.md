# Campus Pickup: handoff

Everything from the design sessions of 30 Sep – 9 Oct 2026, saved so a new Claude account (or a person) can pick up exactly where we stopped.

**Start here:** read this file, then `docs/conversation-log.md`, which has every request, decision and bug fix session by session. Open `prototype/index.html` in a browser to see the latest design (v6).

## What's in this folder
| Path | What it is |
|---|---|
| `prototype/index.html` | **The interactive prototype, v6.** Open in a browser. Needs internet (three.js from cdnjs, the Big Shoulders font from Google Fonts). |
| `prototype/campus-pickup-ui.source.html` | The same page without the `<html>/<head>/<body>` wrapper, the format the Claude Artifact tool publishes. Republish it from the new account to get a shareable link. |
| `docs/build-plan-v1.md` | The original build plan: seven weeks, one campus, go/no-go targets. Still the source of truth for v1 scope. |
| `docs/conversation-log.md` | Session-by-session record (sessions 1–6) of what was asked, built and decided, including the bugs fixed. |
| `docs/chat-transcript.zip` | Full export of the original chat, including the research agents' transcripts. The Google API key that was pasted in chat has been redacted. |
| `research/01-ui-tools-and-references.md` | The four sites from the first brief, the React Native 3D and motion toolkit, reference apps, how to avoid the AI-generated look. |
| `research/02-us-universities-and-growth.md` | Yale, Princeton, Duke and Harvard house sport, IMLeagues, pickup apps, Facebook/Fizz/Yik Yak campus rollouts, Pakistan specifics. |
| `research/03-scroll-driven-motion.md` | Scrollytelling maps, scroll-linked motion on iOS, how to build it in React Native, comfort and Reduce Motion. |
| `research/04-places-and-hangouts.md` | Venue presence and "come join me" hangouts: prior art, safety in Pakistan, cold start, sequencing beyond campus. |
| `research/05-google-maps-platform.md` | Google Maps Platform fit, cost and terms, plus our test results. |
| `labs/google-3d/` | Local Google Maps test page. The key goes in a git-ignored `config.local.js` (see its README). |

The old artifact link (claude.ai/artifact/AX6p7DahvZqeopRb1RSS6c) belongs to the old Claude account and stops working when that account goes. Everything it showed is in `prototype/`.

## The product
- **Started as** a live map of pickup football and tape-ball cricket on one Pakistani campus (LUMS). Two engineers, seven weeks. Go + Postgres/PostGIS backend, React Native + Expo iOS client, MapLibre with self-hosted tiles. The question v1 answers: do games organised in the app actually get played?
- **Has grown into** "places inside places": Lahore › DHA › block › place.
  - Campuses have games.
  - Cafés, parks and turfs have hangouts: host-led, time-boxed, approval-based "come join me" sessions.
  - The plan's v1 scope is unchanged. Everything beyond it is phased (see Roadmap).

## Where the prototype is now (v6)
- **Navigation rule at every level:**
  - **Scrolling moves across a level.** It moves through LUMS's games, DHA's blocks, a block's places, or a place's hangouts.
  - **Zooming moves down or up a level.** Pinch out, use a trackpad pinch, or tap **+** to dive into the card in front of you. Pinch in or tap **−** to pull back.
  - The camera dives or rises to match, and a breadcrumb (Lahore › DHA › Phase 3 › CBTL) lets you tap back up.
- **Home ("Tonight in LUMS"):**
  - A giant one-word title whose letters lift away as you scroll.
  - Scrolling flies the 3D camera from ground to ground in kick-off order.
  - The sky darkens with the hour, and cards stand up as they arrive.
  - Join right from a card.
  - "Explore map" switches to free orbit.
- **DHA blocks (schematic layout, not to scale):**
  - Sector U: LUMS and a park.
  - Phase 3: CBTL Z Block and a futsal turf.
  - Phase 5: CBTL A Block.
  - Phase 6: CBTL Raya.
  - The three CBTL branches are real; Google Places confirmed them.
- **Hangouts at a place:**
  - An "I'm here" count that only includes people who tapped it. Names show only to friends who chose to share.
  - Open hangouts with host, seats and time. Ask to join, then the host approves.
  - Open your own hangout: plan, note, seats, until, visibility. Requests arrive.
  - Women-only hangouts can be hosted only by verified women.
- **Game sheet:** big "spots left" count, pitch formation, live roster, join with an avatar fly-in, a live join plus push notification. The count shrinks into a sticky bar as you scroll.
- **Other tabs:**
  - Your games: availability, positions, Regulars.
  - Game day: check in, bib teams, a 3D Rs 5 coin toss, live ball-by-ball score shown on the map pin, match card.
  - Hostel Cup: a pinned 3D podium that standings slide over.
  - You: a player card that flips as you scroll, notifications, a Calm motion switch.
  - Also: campus waitlist, campus email verification, game chat, report flow.

## Design direction: "Floodlight"
Built from what's on a LUMS ground at 7pm: mown turf, chalk lines, a tennis ball wrapped in red tape, floodlights coming on.
- **Palette:**

  | Name | Hex | Use |
  |---|---|---|
  | Turf | `#1D5B3A` | |
  | Chalk | `#F4F5F0` | |
  | Ink | `#15201B` | |
  | Tape red | `#E3342F` | Actions only |
  | Floodlight | `#FFE3A0` | |
  | Dusk | `#1A2540` | |
- **Type:** Big Shoulders Display for numbers, place names and the giant titles. SF Pro for everything else.
- **Principles:**
  - The number is the headline.
  - The place is real and 3D.
  - The controls stay quiet.
  - Every action gets a response.
  - The camera does one thing at a time (comfort).
- **Avoided on purpose:** dark background with neon green, purple gradients, glass cards over the map, Inter, emoji icons, identical card grids.

## Key decisions and why
- **MapLibre stays the map.** Google has no photorealistic 3D buildings for Lahore (tested 7 Oct: flat satellite imagery). Google 3D would cost about $290 a month at 5k MAU and has no React Native path. Use Google only for:
  - Places, to verify venues once (store the place ID only).
  - Server-side Weather and Air Quality polling, for the conditions strip.
- **Camera in the real app:** glide per chapter with `easeTo` (700–900 ms). Continuous scroll scrubbing waits until a device test holds 60 fps; MapLibre RN has no proven per-frame path.
- **Hangouts, not live location.** Passive "who's nearby" apps died (Facebook Nearby Friends, Zenly, Highlight). Host-led, time-boxed, small-group lasts (Timeleft, Bumble BFF groups). Presence is declared, never detected, and pins are places, never people.
- **Safety in Pakistan:**
  - Abuse mostly happens after people meet, on WhatsApp.
  - Keep chat in-app and ephemeral, and never share phone numbers.
  - Hosts approve strangers. Public venues only.
  - Verification tiers: Campus, then Verified (phone plus selfie), then a further check before hosting.
- **Hostel Cup rewards turning up over winning** (Princeton and Duke models):
  - +10 play, +15 host, +3 kit, +5 win, +50 most different players.
  - Dropping out 2+ h before kick-off costs nothing; a no-show is −10.

## Roadmap (nothing moves into the seven weeks)
- **v1.1, after the plan's four-week go/no-go is met:** Regulars, "I'm free to play" pings, penalty-free drop-out, conditions strip.
- **Phase 2:** game-day check-in, teams/toss/live score, match card sharing, fair-play check, Hostel Cup, player card.
- **Phase 3, second campus:** a campus unlocks at 10% of students on the waitlist plus 2 campus leads running the WhatsApp pilot. Also campus lead kit, SLUMS fixtures, first-year ladder, Ramadan mode, Android.
- **Phase 4, beyond campus:** place levels (DHA › block › place), hangouts at 3–5 venues near LUMS hosted by campus users first, verification tiers, then invite-gated verified non-students in DHA, then Lahore. Venues start free (a "group of 4 coming" signal).
- **Later, revenue:** ground and court booking, inter-campus friendlies, venue offers. The map stays free.

## Recommended React Native stack
Reanimated 4 (`useScrollOffset` + `interpolate` for scroll-linked UI) · Gesture Handler (pinch to change level) · `@gorhom/bottom-sheet` · FlashList v2 · `@shopify/react-native-skia` · `react-native-filament` for real 3D moments · Rive for icons · Moti · `expo-haptics` · MapLibre RN v11 (camera `easeTo`/`flyTo`, `fill-extrusion` buildings, day/night styles) · native tab and nav bars for iOS 26 scroll-edge effects. Avoid react-three-fiber/native and Spline for now.

## Open items
- **Google key (security):** the user's Google Maps demo key was pasted in chat on 7 Oct. Restrict it to localhost and the needed APIs, or rotate it. It's redacted in the saved transcript and kept out of git.
- **Real names:** confirm LUMS hostel names and ground names. The prototype uses placeholders: M-1…M-6, F-1…F-3, "Sports Complex turf".
- **SLUMS:** talk to SLUMS about a pilot partnership and campus leads.
- **CBTL:** decide whether to approach one CBTL branch about a free venue signal.

## Next steps (where we stopped)
1. Review v6 and pick which screens to refine.
2. Set up the Expo project (a dev build, not Expo Go). Commit `openapi.yaml` and build the real v1 screens against a mock server, per week 1 of the plan.

## Prompt to paste into the new account
> I'm continuing a project called Campus Pickup. Read `~/dev/campus-pickup/HANDOFF.md` first, then `docs/conversation-log.md`, `docs/build-plan-v1.md` and the five files in `research/`. The latest prototype is `prototype/index.html` (v6). Keep the "Floodlight" design direction, the "scroll across a level, zoom between levels" navigation and the roadmap phasing. Next step: [what you want].

If the folder isn't on the new machine, clone `https://github.com/abdurrehman-haroon/join_me`, check out the branch `design/floodlight-prototype` (or `main` once PR #1 is merged), and use the `design/` folder instead of `~/dev/campus-pickup`.
