# Prototype feature inventory

Baseline: Floodlight v6, reviewed 2026-10-11. Source: [prototype](../design/prototype/index.html).
Baseline SHA-256: `d3238c502cbbf8fd8fb81d5ef16f5f346736e4d542258f911959194085916ea6`.

This is the durable checklist for feature discussions, implementation, and comparisons with newer prototypes. Listing a feature does not approve it for the first release. [plan.md](plan.md) controls service rollout; [v6-fidelity-plan.md](v6-fidelity-plan.md) controls visual parity.

## Status and comparison rules

- Keep feature IDs stable. Add new IDs rather than renumbering existing ones.
- When a new prototype arrives, record its version/date/hash and compare every row: unchanged, changed, added, or removed. Preserve removed features with their disposition instead of deleting history.
- Record changed behavior, decisions, and implementation gaps against the relevant ID. Split a feature into sub-items if it becomes too large.
- Track frontend and backend separately: unassessed, missing, partial/fixture, implemented, verified, or not applicable. A simulated success or fixture screen is not a connected feature.
- Completion requires agreed behavior, frontend verification, and backend/access checks where applicable. Link evidence when marking verified.

Baseline status: rows were initially **unassessed individually**. Current map progress is recorded below; the other native screens remain partial fixture previews, with full prototype parity deferred. See [handoff.md](handoff.md) for the current aggregate implementation state. The table records prototype behavior, not a claim that it ships today.

## Feature baseline

| ID | Feature | Behavior to preserve or define | Prototype reference |
| --- | --- | --- | --- |
| F01 | Tonight at LUMS | Discover games in kickoff order; show game/player totals and an end-of-feed create action. | `#story`, `storyGames`, `heroFor`, `endHTML` |
| F02 | Interactive 3D campus | Grounds, buildings, game pins, selection highlights, and ground focus. Replace the current approximate scene to meet parity. | `build`, `makePin`, `focusGround` |
| F03 | Scroll-driven storytelling | Camera moves between grounds; cards stand up; title letters lift away; headers collapse; lighting follows the hour. | `storyFrame`, `applyHour`, `titleMotion` |
| F04 | Sport filters | All games, football, or tape-ball cricket. | `filter`, `storyGames` |
| F05 | Time scrubber | Explore evening times, game-pin visibility, and lighting. Confirm how this combines with the story feed. | `onRange`, `visible` |
| F06 | Conditions strip | Weather and air quality. Values are illustrative; real providers, refresh, and stale-data behavior need definition. | `.cond` |
| F07 | Explore map | Switch between guided feed and free orbit/zoom. | `setExplore` |
| F08 | Nested places | DHA → block → campus or venue; counts and focused block outlines. Lahore is a breadcrumb, not a working city-wide view. | `BLOCKS`, `VENUES`, `storyList` |
| F09 | Level navigation | Scroll across siblings; pinch or +/− to change depth; tap breadcrumbs to ascend; animate camera dives/rises. | `goLevel`, `zoomStep`, `renderCrumbs`, `renderRail` |
| F10 | Game cards | Sport, format, ground, kickoff, participants, remaining spots, and full/live/finished states; card and pin open details. | `chapterHTML`, `updateLabel`, `openGame` |
| F11 | Game details | Host/game information, visibility, large spots count, pitch formation, roster, and sticky join bar. | `#gameSheet`, `renderGame`, `formationSVG`, `sheetMotion` |
| F12 | Create a game | Choose sport, ground, kickoff, capacity, visibility, and weekly repeat; show creation feedback and a new pin. | `#createSheet`, `renderCreate`, `selectGround` |
| F13 | Join and leave | Claim/release a roster spot; update card, pin, sheet, and avatar animation. Backend must enforce capacity during concurrent joins. | `join`, `leave`, chapter join handler |
| F14 | Live roster | Other participants' joins update the roster and counts without refresh. Prototype joins are simulated. | `liveJoin` |
| F15 | Game chat | Participant messages and conversation navigation. Membership access, expiry, moderation retention, and reconnect need real services. | `#chat`, `openChat`, `#compose` |
| F16 | Share game | Copy a game link. Prototype confirmation does not establish working clipboard/deep-link behavior. | `toggleMenu` |
| F17 | Report game | Harassment/abuse, spam/fake game, unsafe place/time, or another reason. Submission, review workflow, and response expectations need definition. | `toggleMenu` |
| F18 | Campus verification | Campus email/roll number, six-digit code, resend, ten-minute expiry copy, success, and deferred verification. Demo accepts any six digits; approved email domain remains unconfirmed. | `#verify`, `renderVerify` |
| F19 | Visibility and friends | Campus, mutual friends, verified women; hangouts also offer everyone verified. Restricted results must be hidden server-side. Mutual friendship management and eligibility rules need design. | `renderCreate`, `VIS`, `renderHang` |
| F20 | Trust tiers | Campus verification and stronger verification for non-students/hosts. Prototype copy differs between phone+selfie and phone+ID; choose the actual checks before implementation. | `.tier`, `VIS`, prototype notes |
| F21 | Account controls | Blocked-people view and account deletion confirmation. Both are placeholders; blocking actions, effects, and deletion/retention rules need definition. | `#blockedBtn`, `#delBtn` |
| F22 | Your upcoming games | Joined games ordered by kickoff, with Game Day or result navigation and empty state. Define hosted-game presentation too. | `#tabGames`, `renderGames` |
| F23 | Availability and positions | Free-to-play switch; football/cricket position preferences; weekly day/time grid. | `#availCard`, `POS`, `avail` |
| F24 | Matching pings | Notify suitable available players when a game needs one or two more; prototype promises at most one ping per day. | `#availCard`, notification settings |
| F25 | Regulars | Recurring groups, priority claim deadline, hold/release a spot, then open remaining places to campus. | `regulars`, `renderGames` |
| F26 | Game Day check-in | Arrival ring, missing players, and nudges. Intended once-only proximity check within 150 m, then discard coordinates; demo does not verify location. | `renderGD`, check-in step |
| F27 | Teams | Orange/green bibs, move players, captains, balance, and lock. Copy promises position/social balancing; current demo only shuffles randomly. | `renderGD`, `balance` |
| F28 | Coin toss | Animated Rs 5 coin, heads/tails, winner, and bat/bowl or kickoff/ends choice. Define who can call, flip, and confirm. | `renderGD`, toss step |
| F29 | Football scoring | Track score and finish the match. Define scorer permissions and correction/conflict rules. | `renderFootball` |
| F30 | Cricket scoring | Ball-by-ball runs, wickets, overs, innings, and chase. Confirm supported match rules and corrections. | `renderTape`, `tapeBall`, `endInnings` |
| F31 | Live map scores | Reflect active scores and finished state on game pins. | `liveLabel`, `finishMatch` |
| F32 | Post-match flow | Result, match-card sharing, private fair-play response/report, and repeat with the group. Some actions only show demo feedback. | `renderFull`, `result`, Game Day handlers |
| F33 | Hostel standings | Semester rankings, points bars, own-hostel highlight, and pinned rotating 3D podium. | `#tabCup`, `renderStand`, `initPod`, `cupMotion` |
| F34 | Night Series | Tournament bracket and winning teams. Scheduling, progression, and administrative controls are undefined. | `renderKo`, `#cupKo` |
| F35 | Participation points | Play +10; host +15; kit +3; win +5; most different players weekly +50; leave ≥2 hours early 0; no-show −10. Games count after most players check in. Define evidence, ties, disputes, and corrections. | Hostel Cup rules, prototype notes |
| F36 | Player card | Identity, campus, hostel, positions, played/attended/hosted counts, points, semester insights, tilt/sheen, and scroll flip. Sample statistics need real derivation and privacy rules. | `#pcard`, `startCardIdle`, `cardFlip` |
| F37 | Notification preferences | Someone joined, one spot left, starts in 30 minutes, and a game needs you. Persist preferences and define recipients/deduplication. First-release plan currently includes three events. | `#tabMe`, Notifications |
| F38 | Calm motion | App switch plus device Reduce Motion; replace flights, tilt, and decorative movement with cuts/fades while keeping controls usable. | `#calmSw`, `reduce`, reduced-motion styles |
| F39 | Venue discovery | Cafés, parks, and turfs, with names, type, distance, declared-presence counts, and hangout counts. Layout is schematic; real coordinates need verification. | `VENUES`, `placeHTML`, `updateVenueLabels` |
| F40 | Declared presence | Tap I'm here, leave manually, intended two-hour expiry; counts are opt-in and names are shared only with eligible friends. No passive tracking. | `presenceHTML`, `[data-here]` handler |
| F41 | Discover hangouts | Activity, title/note, host/trust tier, seats, planned/current timing, visibility, and request state. | `hangouts`, `hangoutHTML` |
| F42 | Host a hangout | Choose venue, activity, note, seats, end time, and audience. Verified-women hosting restriction is described; the demo account has it locked. | `#hangSheet`, `openHang`, `renderHang` |
| F43 | Hangout requests | Ask to join, pending status, host approval, and available-seat updates. Rejection is intended behavior but lacks a complete demo flow. Define cancellation, expiry, and concurrency. | `[data-ask]`, `[data-accept]` handlers |
| F44 | Temporary hangout chat | Approval promises chat until the hangout ends. No complete hangout-chat screen/service is demonstrated; define expiry and moderation retention. | approval toast, prototype notes |
| F45 | Campus expansion | Directory by city, live/waitlist/soon states, progress, waitlist sharing, and lead interest. Intended unlock: 10% of students plus two leads running games for two weeks. Counts/actions are examples; actual signup needs definition. | `#campuses`, `renderCampuses`, `CAMPUSES` |

## Shared acceptance requirements

Preserve the Floodlight palette, typography, number-led hierarchy, four-tab navigation, sheets, transitions, and action feedback. Check full/empty rosters, empty lists, locked visibility, sheet dismissal, and reduced motion. Add connected-service loading, offline, validation, permission-denied, stale-data, and retry states using the same visual language; these are implementation requirements rather than complete prototype flows.

## Discussion and implementation log

The full v6 baseline remains preserved above; dated decisions below control the current starting scope.

2026-10-11 decision: start LUMS-only with no sign-in for now and a basic profile. Build the slim pickup flow in `plan.md`; defer full prototype parity and advanced features. Schema discussion must precede frontend-mechanics discussion and implementation. F18 verification is deferred; F19 starts with unrestricted visibility within this LUMS-focused app, without verified-campus claims. Guest identity remains proposed, not approved.

For each feature discussion, record: ID, agreed user flow, business/access rules, frontend status, backend status, dependencies, open questions, and verification evidence. Add dated entries here as decisions are made.

2026-10-11 follow-up: guest sessions deferred. Discuss real map connection and expansion beyond LUMS before implementing the geographic schema. Require automatically managed `created_at` and `updated_at` on every table. Provider, geography model, and identity ownership are still undecided.

## Prototype comparison log

2026-10-11 geographic schema approved: areas/places use `type`, not `kind`; optional boundaries, required place point, optional area parent, and automatic timestamps. Games reference places. Frontend mechanics pending.

2026-10-11 map decision (F02/F08/F09/F39): use a real geographic map with MapLibre for the starting slice. Illustrated 3D parity is deferred. Areas/places schema and frontend mechanics remain proposals; tile provider is not yet approved.

| Date | Reference | Result |
| --- | --- | --- |
| 2026-10-11 | v6, hash above | Initial 45-feature baseline; no newer prototype compared yet. |

## Implementation progress

2026-10-11: OpenFreeMap approved. F02/F07 have an initial real native MapLibre map with free pan/zoom and campus recentre (illustrated 3D parity deferred). F08/F39 have areas/places persistence, public viewport queries, six community-mapped LUMS sports places, clustering, campus outlines and place selection/details; broader area navigation is pending. All application tables have automatic timestamps. iOS simulator build and screenshot verified; real-device gesture review remains. F10 onward game services are not connected; do not mark prototype features complete based on this map foundation.

2026-10-11: generalise games to events. Minimal users plus events, event_participants and a single shared status table are implemented at database level. Event/status model categories use PostgreSQL enums; statuses are shared through events.status_id, with no statusable_id. Optional demo data covers open/full/cancelled/completed events. Event APIs/UI and sign-in remain deferred; no additional prototype feature is complete yet.

2026-10-11: initial connected event browsing supports F04 type filtering and the browse/detail portions of F01/F08/F10: viewport upcoming-event API, exact per-place counts, place lists, event details and participant/capacity displays. This is the slim real-map flow; broader prototype feed choreography, joining and mutations remain pending.

2026-10-11: event creation is connected from the selected map place, with title/type/local start time/capacity, server-owned Scheduled status/demo host and atomic host participation. This implements the slim creation flow; prototype recurrence, visibility, join/leave and authenticated ownership remain deferred.

2026-10-11: connected event Join/Leave uses the demo user, serializes capacity changes with event-row locks, prevents duplicate membership/overbooking, protects host participation and refreshes roster/counts after requests. New joins require upcoming Scheduled state; non-host leaves are allowed regardless of status/time. Host cancellation, Your events, push/live synchronization and sign-in remain pending.

- 2026-10-11: Implemented connected Your events (hosted/joined, Upcoming/Past, pagination) and host cancellation with confirmation using existing status/event tables; no schema change. Notifications remain deferred.

- 2026-10-12: F15 participant messaging implemented for the slim event flow: participant-only HTTP history/send, 50-message cursor pages, foreground polling, UUID retry and read-only cancelled/completed history. Expiry/moderation and push remain deferred; leaving removes access but retains messages.
