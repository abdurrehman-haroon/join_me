Revised build plan · v1 · September 2026

# Campus Pickup

A live map for spontaneous pickup games, launched on exactly one Pakistani university campus. Two engineers, seven weeks, one question answered: do games that get organised in the app actually get played?

**Go** · chi + gorilla/websocket **Postgres** + PostGIS · pgx/sqlc **Redis** · presence & limits **React Native** + Expo · TypeScript **MapLibre** · self-hosted tiles **FCM** · push **Fly.io** · deploy

What\
changed

## The blueprint was written for a funded company. This is written for two people and one campus.

Three things moved. The market went from **three cities to one campus** — map social needs block-level, hour-level density, not national demographics, and an empty map at 7pm on a Friday is a dead app. The product went from a general meetup platform to **one vertical: pickup football and tape-ball cricket**. And the financial model came out entirely, because it assumed monetisation before density and was quietly shaping the roadmap around ad sales you cannot run while also shipping.

Everything the original document put in phase one that depends on scale — surge zones, escrow, QR tickets, host ratings — moved behind the thing that has to work first. If thirty students on one campus will not organise their Tuesday game in this app, none of the rest matters.

The\
wedge

## Pickup sport is the best beachhead in the original document, and the document doesn't notice it.

Generic "meetups" have no natural frequency and no natural host. Pickup games have both, and four properties nothing else in the blueprint has:

- 01

  It recurs without a growth loopThe same twenty people want a game two or three times a week. You get retention from the activity itself rather than from engineering behavioural triggers onto a product nobody opens.
- 02

  The coordination pain is sharp and countable"Need 4 more for 7v7 at 6" is a real, specific problem with a real, specific failure mode. Compare "something is happening nearby", which is a feature in search of a need.
- 03

  Capacity makes the roster the productA game needs exactly N players, so who has committed is genuinely load-bearing information. That is the entire value of the app, and it exists on day one with zero network effect beyond a single pitch.
- 04

  It sidesteps your worst riskAn organised game on a known campus ground between students who share an institution is a fundamentally different safety surface from open mixed-gender meetups with strangers in a 5km radius. You still build the controls — you just aren't betting the launch on them.

**Pick a campus you can walk across.** LUMS, NUST, FAST or IBA — somewhere one of you can physically stand next to the pitch at 6pm and watch whether the app got used. Three thousand people inside one kilometre sharing one timetable is the densest liquidity you will ever get for free.

Scope

## What ships, and what comes back later

The cut list is longer than the ship list, and every cut has a named condition for returning. Nothing here is abandoned — it is sequenced behind the evidence that would justify building it.

#### Shipping in v1

- Sign in with Apple & GoogleNo SMS OTP — Pakistani gateways are slow and it costs per message.
- Campus email verificationOne-time code to *@lums.edu.pk*. This is your trust boundary and your visibility default.
- Create a game pinSport, ground, kick-off time, capacity, visibility.
- Nearby pins on the mapOne PostGIS query with visibility folded into the SQL.
- Join, leave, live rosterCapacity enforced server-side. "4 spots left" is the headline number.
- Pin chat that dies at kick-off + 2hInvisible to users after expiry. Retained server-side for moderation.
- Report buttonWrites to a table one of you reads manually. Ships in v1, not later.
- Three push notificationsSomeone joined · one spot left · starts in 30 minutes. That's all.

#### Cut, with its return condition

- Live location tracking & ETA → Phase 2Apple will most likely grant "While Using", not "Always", which breaks the streaming mechanic as designed. Solve that before building on it.
- Payments, escrow, QR entry → Phase 3Needs hosts charging money. No host is charging for a campus football game.
- Host Reliability Index → Phase 2A rating system with forty ratings in it is noise. Needs volume to mean anything.
- Surge zones → Phase 3Visualises density you do not have yet. On an empty map it advertises the emptiness.
- Kafka → On volumeKeep the publish behind a Go interface so the swap is a day, not a rewrite.
- Android → After the wedge holdsPakistan is roughly 92% Android, so this is a deadline, not an option. React Native means it's a port, not a rewrite.
- Scraping public event sites → NeverSeeds commercial ticketed events — the exact category the original document correctly called irrelevant. Wrong supply teaches users the map is a listings directory.

Stack

## Eight decisions, and what each one costs

Recorded so they don't get reopened every fortnight. Each of these was argued and settled; where a choice has a real downside it is written down next to the choice, not omitted.

- Go for the backendChosen

  Cheap goroutines and low memory per connection make it the best of Go, Node and Python for holding many persistent WebSocket connections. Python was the weakest fit and was ruled out early. Node only won on shared types, and with a dedicated backend person that matters less.

  **Trade-off**No shared types with the React Native client — which is exactly why the OpenAPI contract below is mandatory rather than a nice-to-have.
- Postgres + PostGIS as the single source of truthChosen

  It is the only candidate that can answer "what is within 5km of me", which is the entire product. Managed instance — self-host the app, not the database; running your own backups and failover is the worst return on effort available to you.
- Redis alongside it, never instead of itChosen

  Presence, rate limiting, ephemeral counters. It complements Postgres from week four; it does not store anything you would miss.
- CassandraRejected

  No geospatial queries, no joins, and a heavy operational burden — against write volumes nowhere near the scale that would justify any of it. It would cost weeks and buy nothing.
- KafkaDeferred

  It earns its place once there is a location stream and analytics fan-out to carry. Before that it is a cluster to operate for no benefit. Publish through a Go interface from day one so adopting it later is a day's work, not a rewrite.
- React Native + Expo, not native SwiftChosen

  Pakistan is roughly 92% Android. Android is therefore a deadline, not an option, and Swift would make it a full rewrite instead of a port. TypeScript also happens to be the ecosystem where AI assistance is strongest, which matters for a two-person team.

  **Trade-off**Slightly more friction on background location than native, and an Expo dev build is required from week one — Expo Go cannot run it.
- MapLibre with self-hosted tiles, not MapboxChosen

  Mapbox bills per monthly active user, which is the worst possible shape for an app that opens a map on every launch: free, free, free, then four figures a month in a market where a sponsored pin sells for PKR 3,000 a week. Self-hosted tiles on object storage keep that cost flat regardless of growth.

  **Trade-off**You own the styling and the tile hosting. Verify PMTiles support on MapLibre Native before committing — it is far more mature on web than on mobile. Fallback is tileserver-gl on a cheap VPS, about five dollars a month.
- Our own backend, not SupabaseChosen

  A deliberate call for control, and a reasonable one with a dedicated backend engineer.

  **Trade-off**No row-level security enforcing pin visibility for free. That is the single largest thing given up, and it is why the four rules in the next section are structural requirements rather than advice.

Safety

## Four requirements that are not features and cannot be deferred to week nine

You chose to build the backend yourself, which means you do not get row-level security enforcing visibility for free. The compensation has to be structural, because "remember to check permissions" is not a strategy either of you will sustain at 2am in week six.

- 01

  Visibility lives in the SQL, never in GoThere is exactly one function that returns pins, and the visibility predicate is inside its *WHERE* clause — not a *filter()* applied to the results afterwards. One place to be wrong, one place to audit, no code path that can bypass it.
- 02

  The test is written before the featureA women-only pin, queried by an unverified account and by a male account, returns zero rows. That is the most important test in the repository and it exists in week two, before there is a UI to see pins in.
- 03

  Users see nothing after expiry; you keep everythingGenuinely deleting expired chat also deletes your evidence trail for the first harassment report. Two tables: the user-facing messages that stop being served, and an append-only moderation log neither users nor the API can read.
- 04

  Pins are places, never peopleThe API never returns a user's coordinates to another user. It returns ground locations. Nobody's position is ever derivable from a payload, which removes an entire class of incident from the product before it can happen.

Regulatory, before launch not after

PECA and PTA obligations around content takedown, user data handling and local complaint response apply to a location-based social app carrying user-generated content. Spend an afternoon with someone who knows this properly before you submit to the App Store, not after you have users.

Contract

## Two languages, one definition

Go and TypeScript never see each other's code, so nothing stops the server renaming a field while the app keeps reading the old one — it compiles, it ships, it crashes in front of a user. Write the shape once, generate both sides, and the mistake surfaces on your laptop in thirty seconds instead of in a crash report.

Commit *openapi.yaml* in week one and treat it as the interface between the two of you. Generate Go server stubs with *oapi-codegen* and TypeScript types with *openapi-typescript*, both wired into the build so a drifted client fails CI.

```
-- the one query. visibility is in the WHERE clause, not in Go.
SELECT p.id, p.sport, p.ground_name, p.kickoff_at, p.capacity,
       count(m.user_id) AS joined
FROM   pins p
LEFT JOIN pin_members m ON m.pin_id = p.id
WHERE  p.expires_at > now()
  AND  ST_DWithin(p.location, $1::geography, $2)
  AND (
        p.visibility = 'campus'   AND $3 = p.campus_id
     OR p.visibility = 'women'    AND $3 = p.campus_id AND $4 = true
     OR p.visibility = 'contacts' AND EXISTS (
          SELECT 1 FROM mutuals WHERE a = $5 AND b = p.host_id)
  )
GROUP BY p.id
HAVING count(m.user_id) < p.capacity OR $6 = true;
```

$3 is the caller's verified campus, $4 their women-only eligibility, $5 their user id. A caller who fails every branch gets an empty set — never a filtered-after-the-fact list, and never a 403 that confirms the pin exists.

```
// tables. six of them. resist adding a seventh before launch.
users          — id, apple_sub, google_sub, campus_id, verified_at, gender_flag
pins           — id, host_id, sport, location geography(Point,4326), ground_name,
                   kickoff_at, expires_at, capacity, visibility, campus_id
pin_members    — pin_id, user_id, joined_at        (unique pin_id, user_id)
messages       — id, pin_id, user_id, body, sent_at    (served until expiry)
reports        — id, reporter_id, subject_type, subject_id, reason, status
moderation_log — append-only. no API route reads this table. ever.

// the index that makes the query above free
CREATE INDEX pins_loc_idx ON pins USING GIST (location);
CREATE INDEX pins_live_idx ON pins (expires_at) WHERE expires_at > now();
```

Pin expiry is a *WHERE* clause plus one nightly cleanup job. It is not a scheduler, a queue, or a system — do not build one.

Seven\
weeks

## Two lanes, one contract, one shared week at the end

Agree the OpenAPI contract on day two, then work in parallel against generated types rather than blocking on each other. The client lane builds against a mock server until week three.

Week Backend — Go Client — React Native

01Found.

**Schema & auth**Postgres + PostGIS up on Neon, six tables, GiST index. Apple & Google OIDC token verification via *coreos/go-oidc*, JWT sessions, campus email OTP.

**Shell & map**Expo dev build from day one — not Expo Go, which cannot run background location later. MapLibre rendering your campus tiles. Pre-permission consent card before the OS dialog.

02Core

**Pins & the visibility test**Create and read pins. The single nearby-pins query with visibility in the SQL. The women-only access test, written first and passing before anything else lands.

**Pins on the map**Markers, clustering, the create-pin sheet: sport, ground, kick-off, capacity, who can see it. Against the mock server.

03Roster

**Join, leave, capacity**Server-side capacity enforcement under concurrent joins — this is a transaction, not a read-then-write. Roster endpoints.

**Game detail & joining**The pin sheet, roster list, the "4 spots left" state that is the whole product. First integration against the real API.

04Live

**WebSocket hub***gorilla/websocket*, one room per pin, Redis for presence and rate limiting. Auth on the socket handshake, not after.

**Chat**Message list, send, presence. Reconnection and offline queueing — Pakistani mobile data drops constantly and this is where that gets handled.

05Trust

**Expiry, push, reports**Cleanup job, FCM triggers for the three notifications, report endpoint, moderation log writes. Nothing reads the log.

**Notifications & reporting**Push registration and deep links, report flow, block. Empty states that tell a first user what to do on a map with nothing on it.

06Harden

**Abuse & deploy**Rate limits on pin creation and messages, spam controls, structured logging, deploy to Fly with health checks. Verify the visibility tests still pass against production config.

**Low-data & store prep**Vector tile caching, the text-only fallback when tiles will not load, account deletion (App Store requires it), screenshots, privacy labels.

07Field

**TestFlight on the pitch — both of you, on campus**Thirty real students, real games, one of you physically standing at the ground at kick-off watching whether the app was used or whether they fell back to WhatsApp. Fix what actually breaks — which will not be what you expected — then submit. Budget for two review rounds: background location, UGC and a social graph together attract scrutiny.

First

## Before week one, spend two weeks not writing code

Run the product manually. One WhatsApp group, one campus, thirty players, and one of you doing by hand what the app would do: collecting who is in, posting the count, chasing the last two spots, confirming kick-off.

This costs two weeks and tells you whether the demand is real. If people will not consistently use the manual version — where a human is doing all the work for them — the app version does not fix that. It just costs you seven weeks to learn the same thing.

It also hands you your launch cohort. Thirty people who already coordinate this way are the difference between shipping onto an empty map and shipping onto a working one.

#### Go / no-go after four weeks on campus

- Games created per week, sustained≥ 12
- Games that actually got played≥ 70%
- Players returning the following week≥ 40%
- Games organised without you prompting anyone≥ 50%

Miss these and the honest move is to change the wedge, not to add features or start a second campus. Hit them and you have the only thing worth having: proof the loop closes in one place, which is what you expand — one campus at a time, the way Happening did it one city at a time.

The original blueprint is a document about becoming a platform. This one is a document about getting fifty people to show up to a football match twice. Only one of them can be executed on a Monday morning — and the second is the only route to the first.