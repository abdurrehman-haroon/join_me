# Join Me: design notes

Current engineering decisions, scope and implementation status live in `../docs/project.md`, `../docs/plan.md` and `../docs/handoff.md`. The current visual reference for Explore is `lahore-skin/` (see its README to run it). The earlier v6 prototype, design session log and research notes were removed on 2026-11-04; the product direction and decisions below are kept.

## The product
- **Started as** a live map of pickup football and tape-ball cricket on one Pakistani campus (LUMS). Two engineers, seven weeks. Go + Postgres/PostGIS backend, React Native + Expo iOS client, MapLibre with self-hosted tiles. The question v1 answers: do games organised in the app actually get played?
- **Has grown into** "places inside places": Lahore › DHA › block › place.
  - Campuses have games.
  - Cafés, parks and turfs have hangouts: host-led, time-boxed, approval-based "come join me" sessions.
  - The plan's v1 scope is unchanged. Everything beyond it is phased (see Roadmap).

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
- **Google key (security):** the user's Google Maps demo key was pasted in chat on 7 Oct. Restrict it to localhost and the needed APIs, or rotate it. It is kept out of git.
- **Real names:** confirm LUMS hostel names and ground names. The prototype uses placeholders: M-1…M-6, F-1…F-3, "Sports Complex turf".
- **SLUMS:** talk to SLUMS about a pilot partnership and campus leads.
- **CBTL:** decide whether to approach one CBTL branch about a free venue signal.
