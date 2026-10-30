# Activities: proposed schema and recording contract

Updated: 2026-10-18. Status: all agreed catalogue actions instrumented, including session starts, chat, host edit/cancellation, discovery and creation/event-view-to-join tracking; remaining catalogue actions and broader insights are future scope. The requirement to assess activity tracking for future features is adopted in [ai.md](ai.md). Product questions and the 48-idea inventory remain in [statistics-and-insights.md](statistics-and-insights.md).

## Implemented schema

Table: `activities`. Naming uses `trackable_type` and `trackable_id` as requested.

| Column | Type | Meaning |
|---|---|---|
| id | UUID primary key | Stable activity identity, reused on delivery retries |
| action | activity_action enum, required | What happened |
| user_id | UUID nullable FK to users | Actor, supplied by server identity rather than trusted client input |
| session_id | UUID nullable | App visit, not authentication or proof of a distinct person |
| interaction_id | UUID nullable | One form attempt or event-details visit; grouping UUID, not a foreign key |
| interaction_step | integer nullable | Positive frontend sequence number within an interaction; backend outcomes leave null |
| trackable_type | activity_trackable_type enum, nullable | Related entity type |
| trackable_id | UUID nullable | Related entity ID |
| source | activity_source enum, nullable | UI surface that caused the action |
| occurred_at | timestamptz, required | Action time; server-owned for backend actions, client-reported for browsing |
| details | jsonb required, default {} | Strict action-specific object |
| created_at | timestamptz, required | Database-managed insertion time |
| updated_at | timestamptz, required | Database-managed update time |

Trackable type/ID must both be present or both null. The backend validates existence and allowed action/target combinations; polymorphic references have no ordinary cross-table foreign key. Activities are append-only in normal application use; deletion/retention policy remains to be agreed. Event activities derive sport/place through the event while those fields remain fixed. There are no separate sport, event_id or place_id columns.

## Enum catalogue

Migration 000011 creates these PostgreSQL enums and sqlc types. Extend through forward-only migrations when a feature needs another defined value. The table below is the full catalogue; only the actions listed in the implementation status and discovery/hosting/chat extensions are currently instrumented.

`activity_trackable_type`: `event`, `place`.

`activity_source`: `map`, `place_details`, `event_details`, `event_form`, `event_chat`, `your_events`, `profile`.

Source means the initiating surface: opening event details from personal activity history records `profile`; opening from Your events records `your_events`; tapping Join inside details records `event_details`. It is nullable when no UI source applies, such as session startup. It does not indicate client/server trust; recording ownership is fixed by action.

`activity_action` and its details contract:

| Value | Trackable | Recorder and trigger | Required details |
|---|---|---|---|
| session_started | None | Frontend, once per defined app visit | {} |
| sport_filter_selected | None | Frontend, when user changes the filter | sport |
| place_viewed | place | Frontend, when loaded place details become visible | sport, referrer_interaction_id, zero timing |
| event_viewed | event | Frontend, when loaded event details become visible | snapshot, timing, viewer_role |
| empty_results_viewed | place or none | Frontend, when a successful visible query displays no results | sport, empty_kind; timing for place visits |
| event_creation_started | place | Frontend, when creation form opens | timing (zero at start) |
| event_creation_submitted | place | Frontend, locally valid form submitted | timing, attempt_number |
| event_created | event | Backend, successful event creation | snapshot |
| event_edited | event | Backend, successful edit that changes stored values | changes, snapshot |
| event_cancelled | event | Backend, successful transition to cancelled | previous_status, snapshot |
| join_attempted | event | Frontend, explicit join submission | timing, attempt_number |
| participation_joined | event | Backend, actual non-host membership insertion | snapshot |
| join_rejected | event | Backend, join refused because event is full or closed | reason, snapshot |
| participation_left | event | Backend, actual membership deletion | snapshot |
| chat_opened | event | Frontend, loaded authorised chat becomes visible | timing (zero at start) |
| message_sent | event | Backend, actual message insertion | snapshot |
| interaction_paused | Current interaction's entity | Frontend, visible interaction becomes hidden/backgrounded | timing, reason |
| interaction_resumed | Current interaction's entity | Frontend, interaction becomes visible and foregrounded again | timing |
| interaction_closed | Current interaction's entity | Frontend, explicit close or known successful dismissal | timing, reason |

Loading failures, automatic data refreshes and component rerenders are not new views. A host's automatic membership is represented by event_created, not a separate participation_joined. Successful mutation activities share the business transaction; unchanged/idempotent retries do not create another success activity. Rejected attempts are separate outcomes, never counted as successful joins; their retry semantics must be defined before ingestion implementation.

## Agreed interaction and timing mechanics

The user accepted these mechanics during planning on 2026-10-18. They define the first implementation slice below.

- Opening the creation form starts an interaction. Event details start a measurable interaction when loaded details first become visible. Loading/error screens do not count as an event view.
- Explicitly closing/backing out ends the interaction. Reopening starts a new UUID, including reopening the same entity. UI rerenders and data/realtime refreshes keep the current UUID.
- Backgrounding pauses an existing interaction; returning resumes it only if the same screen is still open. Opening an overlaid screen pauses the underlying interaction. Returning resumes it if it remained mounted/open; mounting alone never establishes visibility. Pause only on the transition from active to inactive, and resume only when both visible and foregrounded, to avoid duplicate lifecycle steps.
- A fresh process launch starts a new session and does not restore old interactions. Session ID groups this process's app visit, including background/resume. It is not an individual identity.
- Queued activities persist across restarts with their original session/interaction/activity IDs. Delivery does not resume those interactions. A killed app may never emit a final activity; do not invent a closing time.
- Active time includes all foreground, visible time, including reading/thinking. No idle detection or keystroke collection.
- Correcting and submitting after failure stays in the same interaction and increases attempt_number. Delivery retries of the same submission retain their original identities and attempt number. A submission after an uncertain result needs business-request reconciliation/idempotency; activity deduplication alone cannot prevent duplicate games.
- Form-filling duration is captured at submission, excluding the subsequent wait for success. Each later submission records cumulative timing from the original opening. Network/request-wait time before a later submission is not evidence of additional typing effort.

### Timing details

Lifecycle steps, place visits and relevant decision/submission actions use cumulative frontend timings:

```json
{
  "elapsed_ms": 90000,
  "active_ms": 50000,
  "attempt_number": 1
}
```

elapsed_ms and active_ms are required for tracked starts, views, pauses/resumes, closes, event_creation_submitted and join_attempted in the first two flows. Start/view timings are zero. attempt_number is required only for submission/attempt actions. For event_viewed these keys accompany snapshot; details also include viewer_role (host, participant or visitor), so conversion reports exclude users who were already participating.

Durations use a monotonic frontend clock with active timing paused while hidden or backgrounded. Validate finite, safe, nonnegative integer milliseconds with active_ms <= elapsed_ms. occurred_at provides the timeline but precise frontend durations must not be calculated by subtracting client and server clocks. Cross-row order/timing consistency is assessed after ordering received steps; late/out-of-order delivery is not itself an invalid interaction.

Pause reason accepts app_backgrounded or screen_hidden; close reason accepts dismissed or completed. These are action-specific JSON values, not new columns. A completed close describes known UI completion; successful creation/joining still requires a backend outcome. A dismissal after success is not abandonment. Disappearance without a known close is incomplete observation.

Example activity rows for one form interaction:

| Action | interaction_step | elapsed_ms | active_ms |
|---|---|---|---|
| event_creation_started | 1 | 0 | 0 |
| interaction_paused | 2 | 30000 | 30000 |
| interaction_resumed | 3 | 70000 | 30000 |
| event_creation_submitted | 4 | 90000 | 50000 |

This reconstructs 30 seconds visible, 40 seconds away and 20 seconds visible. It does not prove typing. Backend event_created shares the interaction ID, has a null interaction_step, and supplies server-owned snapshot/time rather than frontend timing.

### Ordering and duplicate handling

Require interaction_id whenever interaction_step is present; steps must be positive. A unique constraint on (interaction_id, interaction_step) protects frontend ordering; null backend steps remain allowed. The activity primary key protects retry delivery. A matching identity with changed content is a conflict, not an update. Backend actions accept correlation context but never accept client claims of success, actor identity or authoritative event snapshots.

Indexes should match implemented reports: the unique interaction/step index covers ordered interaction lookup; select action/time, actor/time, entity/time or session/time indexes only for concrete report queries. No separate interactions table is proposed.

### Persistent frontend delivery

Accepted direction: a small durable local queue, retried without blocking business actions. Persist activity IDs, original timestamps, steps and durations before acknowledging local storage; serialize queue writes so a late acknowledgement cannot erase newly queued rows. Persistence is asynchronous and does not make delivery guaranteed if the OS terminates the app before a write completes. Keep a bounded queue and bounded request batches, back off on transient failures, retain retry identities, and isolate permanently invalid rows so one cannot block the queue. The implementation keeps at most 1,000 rows for seven days and sends 25 per batch (the API accepts up to 50 rows/64 KiB). It retries from two seconds up to 60 seconds while foregrounded, with a ten-second request timeout; do not present dropped/expired tracking as complete coverage. Avoid persisting form content or message bodies.

Do not silently attribute old queued activities to a different current user. Identity is server-owned; the initial demo identity and future identity switches need explicit queue ownership behavior.

## First implementation slice

Scope: event creation and loaded event-details-to-join, with lifecycle timing and durable delivery. Other actions stay catalogued for later instrumentation rather than being claimed as collected.

1. Add one forward-only activities migration, enum/sqlc types, action/target/details validation and transactional backend outcome recording.
2. Define the ingestion contract in openapi.yaml: client action allowlist, bounded batches, actor assignment, duplicate/conflicting identities, partial/permanent rejection behavior and correlation context on business requests. Backend-only outcomes cannot be forged through client ingestion.
3. Add the persistent queue and interaction timers to the existing EventForm/EventDetails flows, using explicit visibility and app-state transitions. Reuse the existing request guards; no UI change is required to expose tracking.
4. Ensure successful create/join retries do not duplicate either business records or success activities. Current POST /events has no request idempotency contract; activity IDs alone do not fix this. Resolve safe creation retry/reconciliation with the existing API before automatically retrying creation. The activity queue retries tracking only, not business requests.
5. Verify persistence/relaunch, hidden/background durations, lost final rows, repeated opens, out-of-order delivery, duplicate/conflicting deliveries, failed/corrected submissions, backend transaction rollback and server-owned identity/outcomes. Then verify the three initial reports against known scenarios.

Initial reports and definitions:

| Report | Definition |
|---|---|
| Form completion | Distinct started creation interactions with confirmed event_created / distinct started creation interactions; report missing final observations separately and allow a follow-up window |
| Form-filling duration | First valid submission's elapsed/active timings; report successful and unsuccessful attempts separately, using medians/percentiles |
| View-to-join conversion/time | Distinct visitor-role event-view interactions with confirmed participation_joined / visitor-role view interactions; join_attempted timings measure decision time, not server/network waiting |

Reports use UTC and a 24-hour outcome follow-up window. Queue limits are defined above; database retention/deletion remains undecided. No automatic database purge is enabled. No attendance or actual-games-played claims follow from these reports.

## JSON details structure

Details must be a JSON object, never null or an array. Only the listed keys are accepted for each action; reject unknown keys, wrong types and invalid values. Empty contracts accept only `{}`. Do not dump request bodies, event objects or arbitrary metadata into this column.

### Filter and empty results

```json
{"sport": "cricket"}
```

`sport` accepts `all`, `football`, `cricket` or `padel`; these are validated JSON values, not additional table columns. The example above is a filter change. Empty-result details additionally require empty_kind (no_events or no_places); place empties also carry timings, as defined in the discovery extension. For map empty results, source is map and trackable is null; for place empty results, trackable is that place. Do not store GPS or viewport coordinates.

### Historical event snapshot

```json
{
  "snapshot": {
    "participant_count": 10,
    "capacity": 10,
    "starts_at": "2026-10-19T12:00:00Z",
    "status": "scheduled"
  }
}
```

Snapshot has exactly these keys. participant_count is a nonnegative integer; capacity is a positive integer; starts_at is an RFC3339 timestamp; status is scheduled, cancelled or completed. Backend mutation snapshots reflect state after the change. Views describe what the client displayed and must be treated as client-reported observations, not authoritative state. Rejections describe state at rejection. For creation, participant count includes the host. Cancellation snapshots preserve kickoff at cancellation time; join/message snapshots preserve kickoff for lead-time analysis even if the event is edited later.

This is deliberate historical context: current event capacity, start time and status cannot reliably reconstruct past conditions. Fullness is derived from count/capacity rather than stored again. Neither sport nor place is duplicated.

### Join rejection

```json
{
  "reason": "full",
  "snapshot": {
    "participant_count": 10,
    "capacity": 10,
    "starts_at": "2026-10-19T12:00:00Z",
    "status": "scheduled"
  }
}
```

Reason accepts full or closed. An expired scheduled event is closed for joining even if its status is still scheduled. Do not classify generic network failures as full/closed rejections.

### Event edit

```json
{
  "changes": {
    "capacity": {"before": 10, "after": 14},
    "starts_at": {
      "before": "2026-10-19T12:00:00Z",
      "after": "2026-10-19T13:00:00Z"
    },
    "title": {"changed": true}
  }
}
```

Only fields actually changed appear; changes must be nonempty. Allowed fields are capacity, starts_at and title. Capacity uses positive integer before/after values; starts_at uses RFC3339 before/after values. Title records only changed: true, never the title text. Do not record no-op edits.

## Host edit and cancellation tracking (implemented 2026-10-18)

The backend records `event_edited` only when PATCH changes stored values, with `source=event_form`, the configured host as actor, the event as trackable, the changed-field object above and a full post-edit snapshot. It records `event_cancelled` only on the successful status transition, with `source=event_details`, `previous_status=scheduled` and the post-cancellation snapshot. This preserves the roster, capacity and kickoff at cancellation; seconds before kickoff is derived from snapshot.starts_at minus server occurred_at.

Both share the existing event lock and transaction with the mutation and realtime outbox; activity failure rolls back all three. Unchanged PATCH retries and repeated cancellation return 204 without another activity. An intervening edit can make the same PATCH body a real later change, which correctly emits another activity; these endpoints do not add creation-style request receipts. Session/interaction/step remain null for these backend records; edit-form timing and cancellation-intent tracking are deferred. No new frontend behavior or migration is needed. Client ingestion still rejects both backend-only actions.

`backend/reports/hosting.sql` counts edits by field, separates transitions into full caused by joins from capacity reductions, measures cancellation lead time and affected memberships (including hosts), and counts joins/leaves after each reschedule until the next reschedule/cancellation or 24 hours. These are observed associations, not proof that edits caused participation changes. Missing activities and legacy untracked edits limit coverage.

Verification: all previous database/frontend checks passed before implementation. The combined suite covers concurrent identical edits/cancellations, private-title exclusion, changed-field accuracy, authorization/validation/capacity conflicts, cancellation roster preservation and rollback of event timestamps/realtime publication on tracking failure. Repeatable fixtures execute all three report files and verify earlier conversion/timing/discovery results alongside hosting counts and reschedule boundaries. Fixtures run only in an isolated test schema and roll back.

## Reporting and future feature review

Existing application tables supply current facts. Activities supply historical actions and context. Reporting SQL/views define consistent counts and funnels; add stored summaries only when needed. No message bodies, names, exact GPS or free-text cancellation explanations belong in these details. Keep demo/development activity separate from production reporting.

For each new or changed feature, record:

1. Which product question or decision needs evidence, and whether existing records already answer it.
2. Whether activities are needed; an explicit no-tracking decision is valid.
3. For each selected action: exact trigger, actor, trackable, source, allowed details and historical context.
4. Who records it, how retries avoid duplicates, and how reporting distinguishes attempts from successful changes.
5. Whether an existing action can be reused unchanged, or a new enum value/contract is needed.

Remaining implementation details include client ingestion/delivery limits, identity handling, timestamp bounds, deletion/retention and indexes for the implemented reports. The shared demo user cannot establish real individual-user retention. The 33 initially feasible ideas remain proposals, not 33 guaranteed reports from this action set alone; check each report's inputs before claiming coverage.

## Implementation status and operation

Implemented on main, uncommitted/unpushed:

- Migration 000011 adds activities and all catalogue enums, timestamp ownership, paired trackable constraint, positive interaction_step, unique interaction/step and action/time index. Polymorphic references remain backend-validated.
- POST /activities accepts event_creation_started, event_creation_submitted, event_viewed, join_attempted, interaction_paused/resumed/closed and the three discovery actions documented below. JSON details/target/source/time are validated per action. actor_id is a queue-ownership assertion checked against the configured server identity, not a way to select an actor. Results acknowledge accepted/rejected/conflict per row; backend failures may leave earlier rows committed, so unchanged retries are required.
- Backend event_created, participation_joined, join_rejected and participation_left are recorded transactionally with server snapshots/time. No-op successes produce no extra history. Other catalogue actions, including edit/cancel/chat tracking, are not instrumented yet; filter/place/empty discovery tracking is documented below.
- Three optional, all-or-none UUID headers (X-Activity-ID, X-Activity-Session, X-Activity-Interaction) correlate business requests. The ID is a separate stable submission receipt, not the client's submitted-activity ID or step. Creation receipts preserve a SHA-256 normalized request hash in event_created.details.request_hash, never the title/body. Same ID/actor/context/body replays the original 201/event; changed reuse conflicts. A previously accepted join replay does not rejoin after a later leave. Backend receipts leave interaction_step null.
- EventForm freezes a request after an uncertain response; Confirm creation reuses that request and receipt. Definite failures permit corrections and a new attempt/receipt. Mutation requests are not automatically queued/replayed. Closing or process termination does not persist a form draft/request; inspect the event list before starting a new interaction if creation was uncertain.
- ActivitiesProvider owns one session per process/provider lifetime. The durable queue uses two alternating Expo FileSystem snapshots scoped to the API URL, restores the latest complete JSON, serializes writes and removes only acknowledged IDs. Each row retains its actor; /me is rechecked before each batch and old actors' rows are quarantined until expiry. Unattributed rows from a prior process are discarded. Timing uses monotonic frontend measurements; lifecycle visibility explicitly includes child overlays. Native AppState transitions pause/resume timing.
- Internal SQL reports: [backend/reports/activities.sql](../backend/reports/activities.sql), with conversion cohorts, p50/p90 elapsed/active first-submission timing, ordered timelines and unmatched server-outcome counts. Host/already-participant views are excluded from join conversion. Follow-up pending and no-confirmed-completion counts are separate; absence is not proof of abandonment. No statistics UI or public reporting endpoint is added.

Run reports from backend with psql "$DATABASE_URL" -v from='2026-10-18T00:00:00Z' -v until='2026-10-19T00:00:00Z' -f reports/activities.sql. Use the correct environment: the local shared demo identity cannot represent independent real people. Reports do not automatically distinguish test traffic stored in the same database; use separate development/production databases and remove only owned smoke fixtures.

Do not delete server receipt rows while their business request IDs may be retried. Activities currently also retain creation/participation idempotency receipts; any future retention policy must preserve those guarantees or move receipts to separate durable storage first. Client timestamps/durations/context are observations, not trusted proof of behavior. Process death can lose a final lifecycle step or an unfinished asynchronous write; queue limits and rejected rows can also reduce observation coverage.

Verification: database-backed make check and focused Go race tests pass; frontend tests cover timing, pause/resume, restart delivery, acknowledgements and queue/identity boundaries. Controlled SQL fixtures confirmed conversion and duration results and were rolled back. Native smoke checks verified form-open delivery, event view/chat-overlay pause/resume, and a real join with correlated server success. Temporary navigation and owned fixture rows were removed. Full native creation-timeout recovery, process-kill delivery and Android remain device-test limits.

## Discovery tracking extension

Approved scope: sport filter changes, place views and visible empty results, linked to the existing view-to-join flow. These answer which sports people seek, which grounds attract interest and where discovery has no available games. Reuse migration 000011 and its existing enum values; no new table/column/migration is needed.

Contracts:

| Action | Source / trackable | Details |
|---|---|---|
| sport_filter_selected | map / null pair | sport: all, football, cricket or padel |
| place_viewed | map / place | sport at opening, referrer_interaction_id for the map visit, elapsed_ms: 0, active_ms: 0 |
| empty_results_viewed | map / null pair | sport; empty_kind: no_events or no_places; no timing fields |
| empty_results_viewed | place_details / place | sport; empty_kind: no_events; elapsed_ms and active_ms within that place visit |
| event_viewed | place_details / event | Existing view contract plus optional referrer_interaction_id identifying the place visit |

Place visits also use timed pause/resume/close lifecycle rows with source place_details. One map mount owns a discovery interaction and increasing steps for its instantaneous filter/empty activities; a place opening has a separate interaction, preserved across refreshes and paused by event/form overlays. Referrers are grouping UUIDs, not foreign keys or authority; ingestion permits them before the referenced activities arrive. Reports require matching actor/session and the event's actual place when attributing a place visit to a view/join.

Only explicit filter changes are recorded, including selecting All after another sport. Repeated taps on the active filter and programmatic reset after event creation produce no filter activity. Default All at startup is not a user selection.

Empty results are observed only when the map/place is foreground-visible and the latest successful query matches the current bounds/filter. Loading, cancelled/superseded queries, errors, stale prior-filter results and hidden overlays produce no empty impressions. Truncated map results do not count as empty; a place counts empty only when the response is not truncated and its exact count is zero. Successful data refreshes and background/resume do not repeat the same empty impression. A changed settled viewport/filter/empty kind, or a visible nonempty-to-empty transition, can produce a new map impression. Place empties repeat only for a new place visit/filter or visible nonempty-to-empty transition.

Viewport fingerprints (rounded locally to five decimal places to suppress camera jitter) stay in memory and never enter activity JSON or the queue. No camera/GPS coordinates or text fields are collected. The existing server-owned actor, immutable IDs, durable delivery and limits apply.

Internal report: backend/reports/discovery.sql aggregates filter demand, map no-events/no-places observations, place openings/empty impressions and explicitly linked place → event view → confirmed join counts. Place-opening sport is the selected filter at that moment, not the event's sport. Event outcomes allow 24 hours of follow-up and recent cohorts remain provisional; counts describe observed use, not attendance or causal proof of unmet demand. No user-facing statistics UI is added.

Discovery verification (2026-10-18): database-backed make check passes. Tests cover nullable-target ingestion/retries/conflicts, strict per-action/source/detail contracts, coordinate rejection, filter repeat/reset suppression, empty-impression deduplication, place reopening and overlay timing. A rolled-back SQL fixture verified report counts and exclusion of unrelated referrers, other actors and host views. Native simulator verified one filter change for two taps, timed place view/empty delivery, one place view and empty impression across form open/cancel and data refresh, plus explicit place → event → actual join attribution in the SQL report. Owned smoke event/realtime/membership/activity rows were removed after verification; no existing events or memberships changed. Physical-device and Android checks remain outstanding.

## Chat engagement tracking (implemented 2026-10-19)

- `chat_opened`: event target, source `event_details`, actor assigned by ingestion. The frontend starts a zero-timing interaction only after a successful authorized history load and Modal.onShow. Empty/read-only authorized chats count; initial loading, denial and errors do not. History refresh, pagination and realtime updates preserve the visit; closing and reopening creates a new UUID. `interaction_paused/resumed/closed` use `event_chat` and existing visible-foreground cumulative timing. Backgrounding does not create another opening. Client observations are not authoritative proof of membership.
- `message_sent`: backend only, event target, source `event_chat`, server-owned actor/time, null interaction_step and post-insertion snapshot. It shares the message/sequence/outbox transaction; tracking failure rolls all of them back. Optional activity headers correlate with the originating chat visit. A pending message retains its original headers even after chat reopening; the existing message UUID/body contract deduplicates retries, including retries after cancellation. An already saved message is not reattributed by later headers. Legacy callers without headers still produce uncorrelated outcomes.
- No message body, draft, names, message length or extra message ID is copied into activity details. Existing migration/enums suffice. Message storage and frontend pending-draft persistence behavior are unchanged.
- `backend/reports/chat.sql` reports join memberships opening chat/sending a message within 24 hours, stopping on leave/rejoin. The “opening and sending” column means both observed during that membership window; it does not establish order. Separate chat-visit conversion requires matching actor/session/interaction/event and accepts five minutes of client-clock tolerance. It reports messages missing an observed opening separately. Join-to-open uses client timestamps inside server membership windows, so clock skew near boundaries can affect attribution. Recent follow-up is provisional, absence of an opening is incomplete observation, and messages are not proof that a game happened.

Tests cover strict client contracts/privacy, chat timing/reopen identities, transactional message rollback, sequence/outbox preservation, concurrent/unchanged retries, original correlation, read-only/denied sends and fixed report fixtures (including actor/event/time/leave mismatches). Native verification and remaining platform limitations are recorded in handoff.md.

## Session starts (implemented 2026-10-19)

The root ActivitiesProvider queues `session_started` once per new process visit. It reuses the provider's existing session UUID as both activity `id` and `session_id`; `interaction_id`, `interaction_step`, `source`, `trackable_type` and `trackable_id` are null, and details is exactly `{}`. No fabricated screen, interaction or duration is added. Ingestion enforces this shape and the activity-ID/session-ID equality, so the existing primary key prevents another start for that session without a new index or migration. Screen activities still require their previous nonzero interaction/step/source contracts.

The queue guards against repeated effect setup and does not start another session on background/foreground. Relaunch uses a new queue/session and retains any deliverable old rows with their original identities/timestamps. Existing ownership, storage/queue bounds and best-effort delivery limits apply: a first-ever launch killed before identity resolution or persistence is not guaranteed to leave a start. Development JS reloads can create extra visits and are not production usage.

`backend/reports/sessions.sql` counts UTC daily starts and shows observed feature counts within each started actor/session, including actions delivered later or after the cohort's start window. It does not infer session end, duration, bounce or real-person retention; missing starts/late delivery mean incomplete coverage. The shared demo actor is not a distinct-user measurement. No public reports API or user-facing statistics UI is added.

Verification includes strict null/empty-details validation, unchanged ingestion retries and actor checks, effect-replay/background deduplication, failed delivery/restart with old plus new sessions, and all five SQL report files against isolated fixtures. Native launch/background/relaunch results are recorded in handoff.md.
