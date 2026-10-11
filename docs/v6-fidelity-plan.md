# V6 design fidelity plan

Superseded as the immediate milestone on 2026-10-11: the user approved a slim LUMS pickup flow and a real MapLibre/OpenFreeMap map. Follow `plan.md` for current work; preserve this full-fidelity plan for later.

Decision: build **all screens and interactions shown inside the phone in `design/prototype/index.html`** as the current UI milestone. The v6 prototype is the acceptance reference for layout, copy, colors, typography, transitions, gestures, and navigation. Do not replace a designed screen with a generic native screen or the current MapLibre sample map. The existing roadmap remains the order for real backend rollout until it is explicitly changed; fixture-driven UI must be labeled as such during development.

## Coverage

| Area | Match from v6 |
| --- | --- |
| Tonight | Floodlight 3D campus, giant title, sport filter, time scrubber, conditions, game chapters, scroll-driven camera and lighting, Explore map. |
| Games | Pin and card selection, game sheet, spots-left count and sticky state, roster formation, join/leave response, chat, reports. |
| Create and verify | Sport, ground, time, capacity, visibility, weekly repeat control, create animation, campus verification and waitlist states. |
| Your games | Joined/hosted games, availability, positions, Regulars. |
| Game Day | Check-in, teams, toss, scoring, live pin, result and match card. |
| Hostel Cup and You | Podium/standings motion, player-card flip, notifications, Calm setting. |
| Beyond campus | DHA, blocks, places, declared presence, hosted hangouts, approvals, visibility and breadcrumbs. |
| Navigation | Scroll across siblings; pinch or +/- to move between levels; tap breadcrumbs to ascend; game tap opens a sheet. |

Every visible state and interaction in the prototype goes into the parity checklist, including full/empty rosters, restricted visibility, sheet open/close, loading/error states, and reduced motion. Real data and failures must use the same visual language; the prototype's simulated joins and messages are not production behavior.

## Implementation strategy

1. **Freeze a reference.** Pick one iPhone viewport and capture every v6 screen, state, and transition as screenshots and short recordings. Record timing, scroll thresholds, camera positions, and gesture results. Keep the prototype unchanged as the visual master.
2. **Build native screens.** Implement each phone screen, sheet and interaction with React Native components. Use the HTML prototype only as a visual and behavior reference. The WebView proof was rejected as an app implementation.
3. **Build the native scene and motion.** Replace the temporary SVG campus illustration with a native 3D renderer that matches the v6 camera, lighting, fields and scroll motion. Keep MapLibre for geographic data; a normal tile map does not reproduce the v6 scene.
4. **Keep fixtures separate.** Give screens and transitions explicit state, then replace deterministic fixtures with API responses without redesigning the UI.
5. **Connect real behavior.** Define the HTTP/WebSocket contract, then replace fixtures with Go/Postgres data one feature at a time: auth, games, roster, chat, reports, push, then later-phase services. Server responses own counts and access rules. Do not present simulated success as real success.
6. **Compare and approve each screen.** Capture the reference and mobile build at the same viewport and state. Compare layout, typography, colors, copy, and animation side by side. Test navigation paths, gestures, accessibility/Calm motion, and network failure states on-device. A screen is complete only after its parity checklist passes and the user reviews it.

The current native build is an initial pass, not a 1:1 copy. Leave all work uncommitted and unpushed for review.

## Current UI mapping

`design/prototype/index.html` is the visual source. `frontend/index.ts` registers `frontend/src/NativeApp.tsx`. `frontend/src/CampusScene.tsx` draws the current SVG map illustration. No HTML is bundled into the mobile app.

| Prototype area | Phone element | Current behavior |
| --- | --- | --- |
| Tonight, 3D map, chapters, level navigation | `#map`, `#story`, `#chapters`, `#crumbs` | Native scroll and cards; illustration and movement are incomplete |
| Game details, create, hangouts | `#gameSheet`, `#createSheet`, `#hangSheet` | Native details and create fixtures; hangouts missing |
| Chat, verification, Game Day, campuses | `#chat`, `#verify`, `#gameday`, `#campuses` | Native chat, Game Day and campus fixtures; verification missing |
| Your games, Hostel Cup, You | `#tabGames`, `#tabCup`, `#tabMe` | Native tabs; podium and player-card motion incomplete |

Parity review still needs each screen, sheet state, scroll/zoom transition, Calm mode, and a real-device frame-rate check. Prototype actions must be connected to the Go API before they represent real games or users.
