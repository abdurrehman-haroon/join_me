# Starting build plan


## Agreed scope (2026-10-11)

LUMS first, expanding outwards. No sign-in or campus verification for now; keep a basic profile. Guest sessions are deferred. Always discuss schema first, then frontend mechanics, then implement each feature.

1. **Real map foundation:** MapLibre + OpenFreeMap, areas/places in PostGIS, automatic timestamps, viewport API, selection sheets, clustering, recentring, and loading/error states. Implemented; review on device and confirm community-mapped LUMS data.
2. **Basic users and events:** minimal users schema and basic profile viewing/name editing implemented without sign-in or schema changes. Reuse users, with sign-in later and no ownership tokens. Approved events/shared status/event_participants database schema implemented, replacing pins/pin_members; optional demo seed available. Read-only event APIs, viewport browsing, type filters, place event lists and participant details are connected. Creation from a selected place is implemented with a demo host, future start time, capacity validation and atomic host participation. Join/leave is implemented with event-row locking, transactional capacity checks, idempotent retries and host-leave protection. Your events and host cancellation are implemented without schema changes.
3. **Pilot essentials:** participant chat, cancellation and kickoff notifications. Host cancellation and participant chat are implemented; notifications are deferred at user request. Reporting is skipped for now; its legacy table is removed by migration 000009. Discuss each schema and frontend flow before implementing.
4. **Real student pilot:** review data, test poor networks and real devices, deploy, and observe whether organised games happen.

All tables require database-managed `created_at` and `updated_at`. New migrations are numbered, forward-only and tracked; applied files are immutable. Fixed-value fields require PostgreSQL enums, never text. The approved geography uses `type`, not `kind`, optional area parent/boundaries, required place points, and event references to places.

Participant messaging is implemented: automatic timestamps, participant-only history/send, cancelled/completed read-only history, cursor pagination, shared WebSocket delivery, drafts and UUID retry. Changes remain uncommitted for review.

Device location (2026-10-13): approved frontend-only scope implemented with Expo Location, on-tap foreground permission, live dot/accuracy circle, My location recentring, Campus return, denied/services-off/timeout retry states and subscription cleanup. No schema/API change or background tracking. Simulator/device verification is recorded in handoff.md.

## Realtime integration (2026-10-15)

Implemented the user-frozen streams/outbox/message-sequence schema, transactional event/chat publication, shared WebSocket server/client, sequence recovery, membership revocation and HTTP long-poll fallback. Event details update roster/count/status in place; chat no longer polls every four seconds. Details and chat share one connection while visible. See realtime.md and handoff.md. Sign-in, map-wide live updates and Your events live subscriptions remain separate work.

## Activity tracking (implemented 2026-10-19)

The approved catalogue is complete: session starts; sport filters, place/event views and empty results; creation/submission outcomes; join attempts/rejections, joins/leaves; host edits/cancellation; chat opens/messages; and pause/resume/close timing. Migration 000011, persistent delivery, strict ingestion and retry-safe transactional outcomes are implemented. Five SQL reports answer discovery, conversion, hosting, coordination and visit questions.

[activities.md](activities.md) is the recording/schema/details contract; [handoff.md](handoff.md) owns verification results and remaining device coverage. Future features must explicitly assess tracking needs per ai.md. Personal statistics are implemented below; production identity, database retention/deletion and broader insights remain decisions.

## Deferred

Broader statistics/user-insight proposals remain in [statistics-and-insights.md](statistics-and-insights.md) and require feature-specific discussion before implementation.

Notifications, Android/physical-device verification, moderation reporting (legacy table removed), full illustrated-v6 parity, 3D camera choreography, beyond-campus social features, restricted visibility, verification, Regulars, availability/matching, scoring, Hostel Cup, and campus expansion services. The geographic model supports more campuses/places without a LUMS-specific query. Expansion UI and services remain separate milestones.

`feature-inventory.md` preserves all 45 v6 features and dated scope decisions for future prototype comparisons. `v6-fidelity-plan.md` and `prototype-integration.md` preserve earlier design/rollout references; this current scope takes precedence.

Only connected UI ships: Map, Your events and basic You profile. Hostel Cup, fixture game/chat/Game Day/campus sheets, fake player stats and unsupported settings were removed. Prototype references remain in design/.

Local macOS startup: double-click startup.command (runs startup.sh) to start PostgreSQL if needed, backend, Metro and the iPhone 18 Pro / iOS 27 development app. Ctrl+C stops launcher-owned servers; existing servers and PostgreSQL stay running. See README.md.

Host event editing implemented: PATCH /events/{id} accepts title/start/capacity together for the configured demo host, only while scheduled and upcoming. Place/type stay fixed; shared event locking prevents capacity reductions below concurrent membership. Existing DB timestamps remain automatic; no migration. Shared EventForm supports creation/editing with prefilled local time, Save/Cancel, draft retention and request guard. Success refreshes details/map/Your events; closing refreshes uncertain results. Hosting/deployment stays deferred.

## Personal activity (2026-10-19)

Approved user-only scope: You tab → Your activity, with joined/hosted totals, separate left/cancelled counts, sport breakdown, top three grounds and paginated history linking to event details. Month/all-time selection uses the device IANA timezone; first known signup/creation dates define summary cohorts, while history filters each action date. Rejoining counts once and host membership is excluded from joined. Totals include left/cancelled events; these are signups, not attendance.

GET /me/activity derives identity from the server, accepts no user selection and reads existing events/memberships/server-owned activities. Current memberships supply pre-tracking joins; deleted untracked memberships cannot be recovered. No schema or migration change. Existing internal reports are unchanged.

Tracking assessment: reading statistics, changing period and refreshing do not need new activities. Opening history event details reuses event_viewed with the existing profile source, same actor/event/snapshot/timing and retry rules; subsequent detail/chat actions retain their existing sources. No extra personal data enters activity details.

## Host signup insights (2026-10-19)

Approved event-details scope: host-only signup progress, first known signup timing, first recorded capacity milestone and distinct joined/left player counts. GET /events/{id}/signup-insights uses the server-owned demo identity and separate SQL; no schema change or private fields in shared event/realtime payloads. Existing current capacity includes the host; player counts exclude the host. Rejoins count once; left counts players who left at least once even if they rejoin. A recorded leave also proves an earlier signup for legacy events. First signup uses server join history/current membership dates. Capacity milestones distinguish signup, capacity reduction and initially full; current fullness is not invented history. Events without event_created history show an incompleteness note.

The host card refreshes on event sequence changes and realtime recovery, retaining its previous data while the authorized HTTP refresh runs. It reuses the event WebSocket subscription and existing long-poll fallback; no separate stream or periodic poller. Failed refreshes label last-loaded data; only an error-retry action remains; the routine Refresh button is removed. The card stays available for past/cancelled events. Tracking assessment: these derived reads add no activity; existing event view and mutation contracts suffice. Internal SQL reports remain unchanged.

## Joiner goals, milestones and recap (2026-10-19)

Approved implementation: users.event_goal_target (positive nullable integer) and users.event_goal_period (nullable weekly/monthly PostgreSQL enum), both set or both null. Migration 000012 adds the pair without changing existing identities or timestamps. One active goal applies to the current and following periods; PUT /me/event-goal uses the server-owned identity, accepts both fields and can turn the goal off. Goal progress is not persisted.

Your activity now includes a weekly/monthly goal editor (presets plus custom positive target), goal progress, derived first/5/10/25-event and first-sport milestones, and a current-month recap with previous-month comparison and separate hosted count. Existing signup-date history/totals keep their original meaning. New progress/recap use scheduled event dates and current non-host memberships, exclude cancelled/left events and include upcoming events. Hosting recap excludes cancelled events. Rejoining counts once. Leaving/cancellation can remove milestones or progress; rescheduling can move period credit. These are signups, not attendance. Weeks start Monday in the requested device IANA timezone, with local calendar month/week boundaries including DST.

Tracking assessment: no new activities; saved goal settings and existing event/membership data answer these user-facing questions. Freshness: reuse personal-report HTTP refresh on entry, foreground, goal save, returning from event details and explicit Refresh activity. No new socket stream or periodic/background polling for these summary panels; existing host-insight realtime behavior is unchanged. Requests are cancelled on cleanup; save failures preserve the goal draft and retries set the same values safely.

## Future: automatically assigned event goals (2026-10-20)

Plan only; keep the current user-configured goals and implementation unchanged for now. Eventually, goal targets will be assigned by the system instead of entered by users. A weekly/monthly job will use confirmed events actually attended in the previous completed matching period to set the next period's target:

`next_target = max(2, ceil(attended_count * 1.5))`

Examples: 0 attended → 2; 1 → 2; 2 → 3; 3 → 5; 4 → 6. Round upward to a whole event. Calculate from actual attendance, not the previous target or signup count; preserve the existing host/joiner separation for joiner goals.

This depends on implementing reliable attendance confirmation first. Define job timezone/period boundaries, late attendance corrections and safe repeat execution before implementation. Reassess activity recording and goal-update delivery during that feature's planning. The job and attendance-based goal calculation remain future work.

## Floodlight map pass (2026-10-20)

Frontend-only first step of bringing the v6 design into connected screens; no schema or API change. Partially revisits the 2026-10-11 deferral of 3D camera choreography; uncommitted for review with the team.

- **3D map:** the map opens with the flat campus fit, then tilts to 55° (bearing -20°, half a zoom level closer) so OpenFreeMap's existing `building-3d` layer stands up. Recentre returns to that tilted view. MapLibre's initial bounds fit ignores pitch, which is why the tilt runs after load.
- **Glides:** tapping a ground in Explore mode eases the camera to it (zoom 17, pitch 60°, 900 ms, framed above the sheet). iOS Reduce Motion makes this instant.
- **Floodlight style:** the Liberty style is fetched and eight named layers are recoloured (background, park, grass, pitch, track, water, building, building-3d). If the fetch fails, the original style URL is used.
- **Dusk:** a world-covering tint layer, drawn below our own layers, darkens the base map by hour (approximate: dusk from 17:00, dark 19:00–06:00, not real sunset times); 3D-building light cools after dark. The hour follows the home story's scroll position, otherwise the current time.
- **Data freshness:** the home story queries `/events` with the campus bbox (so it does not shrink when zoomed) on open, filter change, after this user's create/join/cancel (`eventRefresh`) and when the app returns to the foreground. No realtime: map-wide live updates remain separate work.
- **Activity tracking:** no new activities. Opening details from a card reuses existing event-view tracking with the map discovery interaction as referrer. Story scrolling is not recorded; tracking it would need a new `activity_source` value and a schema discussion.
- **Base map:** shop/amenity icons, path and minor street names and one-way arrows are hidden so game pins stand out; main road names and area labels remain.

## Event details: spots-left headline (2026-10-20)

Frontend-only Floodlight pass on event details; no schema or API change. `SpotsLeft` replaces the small participant/capacity box: available spots as a 120 pt Big Shoulders number in tape red with "spots left" / "Last spot", "N of M going", and one dot per place (taken in turf, open as red rings; hidden above 30 places). Full shows a grey "Full"; cancelled/completed/started show the status word with "Joining closed". When the count changes (own action or a realtime `event_details` update) the old number drops out and the new one drops in over 420 ms with the native driver; Reduce Motion makes it instant. The block is one accessible element with a polite live region, so count changes are announced. A shared `useReduceMotion` hook now serves the map and this block.

- **Data freshness:** unchanged; uses the existing event-details WebSocket/long-poll updates.
- **Activity tracking:** none needed; the screen's existing event-view and join tracking are untouched.

## Home story: v6 scroll and zoom levels (2026-10-20)

The product owner asked for the v6 home experience on real data, replacing the 2026-10-11 deferral of 3D camera choreography for the home screen. Frontend only; no schema or API change. Replaces the horizontal feed from the Floodlight map pass.

- **Story:** the Map tab opens on a vertical story over the tilted map (`TonightStory.tsx`). A giant title word (LUMS, or the ground's name) is scaled to the screen width and its letters lift and tilt away as you scroll; the kicker reads "Tonight in" when every game is today, otherwise "Coming up in". A compact title with the story's clock fades into the top bar.
- **Camera follows scroll:** each level has camera frames: an overview, one per game (in kick-off order) and an end frame. Every scroll event interpolates between the two nearest frames (hold near a card, ease between, a small lift between grounds, short-way bearing turns) and calls MapLibre `jumpTo`. Scrolling snaps to each game so its ground is framed above its card. The map light follows the interpolated time in ten-minute steps; the story starts now, or 30 minutes before the first game if that is on a later day.
- **Cards stand up:** below the focus line cards lie back (rotateX up to 40°) and rise to upright as they reach it, then tilt slightly and fade above it. Native-driver `Animated` interpolations; no new native dependency.
- **Levels:** Lahore › LUMS › ground. Pinch out (two-finger spread on the story), the + button or a card's "Zoom in" dives into the game's ground; pinch in, − or the LUMS breadcrumb pulls back. The camera flies 1.6 s to the new level's overview and the story grows in (dive) or settles down (pull back). The ground level circles that ground, one bearing step per game, and its end card starts a game there. Lahore is shown but not tappable. DHA, blocks and venues (CBTL etc.) need area/place data and are the next step.
- **Explore mode:** the Map button (or "Explore the map") switches to the previous free map with its pins, filters, place sheet and location controls; "Back to tonight" returns and flies to the story's overview. Only Explore mode reloads places/events when the camera moves.
- **Reduce Motion:** title, card tilts and the level entrance are static, and the camera cuts between frames instead of travelling.
- **Data freshness and tracking:** unchanged from the Floodlight map pass (campus `/events` query; no realtime for the story; no new activities).

## Home story on the illustrated 3D campus (2026-10-20)

The product owner asked for the v6 template's look, not a real street map: the home story now runs over an illustrated 3D model of LUMS rendered natively with three.js on `expo-gl` (new native dependency; dev-client rebuilt). The real MapLibre map is only mounted in Explore mode.

- **Built from real data:** the campus outline and grounds come from our API (`areas.boundary`, `places.location`/`boundary`). Four-cornered grounds become pitches/courts at their real size and angle, rounder ones become ovals. Building footprints (65) and paths (118) inside the LUMS boundary were extracted once from OpenStreetMap into `frontend/assets/lums-campus.json` (ODbL; attribution shown on the scene). OpenStreetMap has no trees mapped there, so low-poly trees are scattered as in v6. One scene unit is 15 m; building heights are exaggerated (0.55 units per level, 2 levels when unknown).
- **Look (ported from the v6 prototype's scene code):** striped football pitches with markings, a mown cricket oval with pitch strip and rope, coloured hard courts, floodlight poles with heads and beams that switch on at dusk, buildings whose windows light up at night, a sunset-to-night sky and fog, a floating football (or red tape ball for cricket) over each ground with games, with a native "x left" label for its next game, and a pulsing red ring on the ground in focus. Textures are painted into pixel buffers (`sceneTextures.ts`) because React Native has no 2D canvas.
- **Camera:** the v6 orbit model (target, distance, tilt, turn). Scroll frames come from `MapScreen.storyFrames`; the scene eases towards the latest frame every frame, slower for level changes.
- **Performance choices:** Lambert materials (no physically based shading), no real-time shadows, no point lights (floodlit pitches use an additive light pool), no MSAA, rendered at half the screen's pixel density and scaled up, idle frames capped at 30 fps, and each frame waits for the GL thread so frames never queue up. The iOS Simulator renders OpenGL ES in software: about 0.2 s per frame and roughly a minute to compile shaders on launch. A physical-device check is still needed.
- **expo-gl workaround:** expo-gl's WebGL 2 context class inherits from its WebGL 1 class, so three.js's "WebGL 1 not supported" check is bypassed by hiding the WebGL 1 global only while the renderer is created.
- **Explore mode in 3D (same day):** the Map button switches the same scene (never rebuilt) to free exploring: one finger turns and tilts, pinch zooms (20–140 units), two fingers pan, and tapping a ground, its ball or its label flies to it and opens the place sheet with its games and "+ Create event here". My location shows a blue dot on the campus and moves there when within about 1.8 km; ⌂ returns to the overview; Tonight returns to the story. Location errors only show after My location is tapped. The MapLibre street map is no longer used by any screen.
- **Open decision:** `@maplibre/maplibre-react-native` is still installed (and in app.json plugins) but unused; `project.md`/`code-practice.md` still describe MapLibre as the map. Removing it needs a dev-client rebuild and a docs update; DHA/city levels may want real geography again.
- **Not yet built:** DHA/area levels need area/place data.
- **Activity tracking:** unchanged events; map discovery impressions (`observeMapResults`/`observePlaceResults`) are recorded only in Explore mode, using the campus bbox as the view.

