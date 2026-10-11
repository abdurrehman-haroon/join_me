# Campus Pickup mobile app

Expo SDK 57 / React Native, with a native MapLibre map and OpenFreeMap Liberty tiles. `index.ts` registers `src/NativeApp.tsx`; `src/MapScreen.tsx` owns the connected map. Only connected screens ship in the app: Map, Your events and You.

## Run

Start the Go API and PostGIS database first (see `../backend/README.md`). With Xcode and an iOS simulator:

```sh
pnpm run ios
```

MapLibre requires a development build; Expo Go does not include its native module. After changing config plugins, run `pnpm exec expo prebuild --platform ios` before rebuilding. For later JavaScript updates, use `pnpm start`, then `i` to open the app or `r` to reload it.

Configuration (Expo public environment variables, no secrets):

- `EXPO_PUBLIC_API_URL`: defaults to `http://localhost:8080` for the iOS simulator. On a physical phone, use your computer's reachable LAN address; production needs HTTPS.
- `EXPO_PUBLIC_INITIAL_AREA_ID`: defaults to the seeded LUMS UUID. Select another mapped area without changing geographic code.
- `EXPO_PUBLIC_MAP_STYLE_URL`: defaults to `https://tiles.openfreemap.org/styles/liberty`. A replacement style must include the Noto Sans Regular glyphs used by our labels, or adjust the label font with the style.

Restart Metro after changing environment values.

## Connected map behavior

The map opens at the area's bounds, supports free pan/zoom and campus recentring, fetches viewport places after movement settles, clusters points at low zoom, and opens place details with a highlighted outline. Loading, empty, timeout, failed-request, and retry states are present. No location permission or sign-in is requested. Map attribution remains enabled.

The initial six places and campus outline come from OpenStreetMap, not verified campus records. Event browsing is connected; creation is connected from a selected place; joining/leaving is connected in event details. Hostel Cup, fake stats/settings and sample action sheets have been removed. Full illustrated-v6 parity is deferred under the current slim scope.

Checks: `pnpm exec expo lint index.ts src` and `pnpm exec tsc --noEmit`.

Event browsing is connected in the map tab: All/Football/Cricket filters, upcoming-event counts on individual place markers, place event lists, and event details with host/status/roster/capacity. Clusters label the number of places; zoom in for individual event counts. Cancelled/completed events are excluded from upcoming lists but remain available by API ID. Viewport responses are limited to 1000 events and ask users to zoom in when truncated. Use the selected-place creation flow for events.

To create an event, tap a place then **Create event here**. Enter title, type, YYYY-MM-DD date, 24-hour HH:mm start time and positive capacity including the host. Time uses the phone’s local zone and is sent as an ISO timestamp. The API assigns the demo user; load backend demo data first. Submission blocks repeated taps, preserves values on errors, and asks users to check the list after uncertain network failures. Success returns to the place sheet, refreshes event counts without recentring, and resets the filter to All so the new event is visible.

Event details now show Join, Leave, Full, Joining closed, or host information using the API’s demo-user viewer flags. Both actions block repeated taps, refresh roster/capacity and the map after the request, and reconcile uncertain failures with the server. Hosts cannot leave; non-host leaves are allowed regardless of status/time. Run the demo seed again to add **Demo: joinable cricket**, hosted by Sara, which default Demo Ali can join and leave. Sign-in remains deferred; Your events and host cancellation are now connected.

Your events uses `GET /me/events?section=upcoming|past&offset=0` (50 events/page, nullable `next_offset`). Hosted and joined events are included independently of map bounds. Past includes cancelled/completed/elapsed events. `PUT /events/{id}/cancellation` lets only the configured demo host cancel upcoming scheduled events; repeat cancellation succeeds. The roster is retained, and cancellation locks the same event row as participation. Native details require confirmation, reconcile after changes, and refresh Your events/map. No notification delivery or schema migration is added.

Participant event chat opens from event details after joining (hosts are participants). History loads 50 at a time, refreshes every four seconds only while the chat is visible and the app is active, and catches up on foregrounding. Older messages retain scroll position; new messages offer a jump when reading history. Drafts and pending sends remain in memory when closing/reopening chat for the same mounted event; retries reuse the same UUID. Cancelled/completed events show read-only history. Reports, push and sign-in remain deferred.

## Basic profile

The You tab loads the server-configured demo user with GET /me. Edit name opens a single field with Save/Cancel; PATCH /me trims and validates 1–100 Unicode characters on one line, returns the saved profile and uses the existing automatic timestamps. Failed/uncertain saves retain the draft for retry; Cancel reloads the saved name. Re-entering Map/Your events/chat fetches current display names. No fake campus verification, account actions, statistics or notification settings are shown. Sign-in stays deferred.
