# Campus Pickup mobile app

Expo SDK 57 / React Native, with a native MapLibre map and OpenFreeMap Liberty tiles. `index.ts` registers `src/NativeApp.tsx`; `src/ExploreScreen.tsx` owns the connected Explore map. Only connected screens ship in the app: Explore, Your events and You.

## Run

Start the Go API and PostGIS database first (see `../backend/README.md`). With Xcode and an iOS simulator:

```sh
pnpm run ios
```

MapLibre requires a development build; Expo Go does not include its native module. After changing config plugins, run `pnpm exec expo prebuild --platform ios` before rebuilding. For later JavaScript updates, use `pnpm start`, then `i` to open the app or `r` to reload it.

Configuration (Expo public environment variables, no secrets):

- `EXPO_PUBLIC_API_URL`: defaults to `http://localhost:8080` for the iOS simulator. On a physical phone, use your computer's reachable LAN address; production needs HTTPS.
- `EXPO_PUBLIC_MAP_STYLE_URL`: defaults to `https://tiles.openfreemap.org/styles/liberty`. A replacement style must include the Noto Sans Regular glyphs used by our labels, or adjust the label font with the style.

Restart Metro after changing environment values.

## Connected map behavior

Explore loads Lahore's districts, places and upcoming events from the hierarchy API. Its Map button unlocks free pan/zoom behind the same cards; selecting districts and events updates the camera and highlights. Loading, empty, failed-request and retry states are present. No location permission or sign-in is requested. Map attribution remains enabled.

The Lahore development catalogue includes community-mapped OpenStreetMap locations and approximate unverified entries described in `../backend/seeds/lahore_catalog.sql`. Event browsing, creation from a place, joining/leaving and details are connected. Hostel Cup, fake settings and sample action sheets have been removed.

Checks: `pnpm exec expo lint index.ts src` and `pnpm exec tsc --noEmit`.

Explore shows the coming seven days through Lahore district and place cards. District feeds include up to 20 events per place; a place page includes up to 100 and reports when more exist. Cancelled, completed and elapsed events are excluded from Explore but remain available by API ID and in Your events.

To create an event, open a place and choose **Create event here**. Enter title, type, YYYY-MM-DD date, 24-hour HH:mm start time, optional place spot and positive capacity including the host. Time uses the phone’s local zone and is sent as an ISO timestamp. The API assigns the demo user; load backend demo data first. Submission blocks repeated taps, preserves values on errors and reuses its request receipt when confirming an uncertain result.

Event details show Join, Leave, Full, Joining closed, or host information using the API’s demo-user viewer flags. Both actions block repeated taps, refresh roster/capacity and Explore after the request, and reconcile uncertain failures with the server. Hosts cannot leave; non-host leaves are allowed regardless of status/time. Sign-in remains deferred; Your events, host editing/cancellation and host signup insights are connected.

Your events uses `GET /me/events?section=upcoming|past&offset=0` (50 events/page, nullable `next_offset`). Hosted and joined events are included independently of Explore. Past includes cancelled/completed/elapsed events. `PUT /events/{id}/cancellation` lets only the configured demo host cancel upcoming scheduled events; repeat cancellation succeeds. The roster is retained, and cancellation locks the same event row as participation. Native details reconcile after changes and refresh Your events/Explore. No notification delivery is added.

Participant event chat opens from event details after joining (hosts are participants). History loads 50 at a time; the shared WebSocket connection delivers updates and recovers gaps, with long polling when sockets are unavailable. Older messages retain scroll position; new messages offer a jump when reading history. Drafts and pending sends remain in memory when closing/reopening chat for the same mounted event; retries reuse the same UUID. Cancelled/completed events show read-only history. Push and sign-in remain deferred.

## Basic profile

The You tab loads the server-configured demo user with GET /me. Edit name opens a single field with Save/Cancel; PATCH /me trims and validates 1–100 Unicode characters on one line, returns the saved profile and uses the existing automatic timestamps. Failed/uncertain saves retain the draft for retry; Cancel reloads the saved name. Personal activity, event goals, milestones and monthly recap are connected. No fake campus verification, account actions or notification settings are shown. Sign-in stays deferred.

## Activity tracking

Event creation and loaded event-details-to-join use interaction IDs/steps and monotonic elapsed/foreground-visible timings. Backgrounds and overlays pause active time; reopening starts a new interaction. Reading/thinking counts as active. Process restarts do not restore old interactions.

ActivitiesProvider persists a bounded queue through Expo FileSystem (already included in the development build), scoped to API URL. It keeps up to 1,000 rows for seven days, sends batches of 25 while foregrounded, and retries unchanged IDs with bounded backoff. Actor identity is rechecked before delivery; old actors are never silently reassigned. App termination can lose the last unwritten activity. The queue never retries business mutations.

After an uncertain creation, fields are frozen and Confirm creation reuses the original request receipt/body. A definite rejection allows corrections. Closing the form does not persist its draft or request; check the event list before starting another attempt after uncertainty. See ../docs/activities.md. make check includes deterministic activity timing/queue tests.

Explore records city/district views once per session, place views and event-detail views. Place timers pause under event/form overlays, and referrer interaction IDs link place visits to event views. The removed Map screen's sport-filter and empty-result actions remain only as historical database/report values and are rejected by client ingestion. See `../docs/activities.md`.

Chat activities start only after an authorized history load and visible modal, pause in background and close/reopen with fresh interaction IDs. Refreshes preserve the visit. Pending messages keep their original activity headers on Retry even after reopening; message contents stay out of activities. `pnpm run test:activities` covers chat lifecycle timing as well as earlier flows.

The root activity queue records one `session_started` per process visit, reusing the session UUID as activity ID. Effect replay and background/foreground do not create another start; relaunch starts a new session while saved deliveries retain their original IDs. No screen, entity or timing details are attached to startup.
