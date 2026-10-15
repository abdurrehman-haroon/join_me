# Realtime events and chat

## Frozen schema

Migration 000010 adds only the agreed `realtime_target_type` enum (`event_details`, `event_messages`), `realtime_streams`, `realtime_outbox`, and `messages.sequence`. Targets retain the polymorphic `target_type`/`target_id` pair. No event revisions, message counters on events, payload versions, or message-type enum. Both new tables use database-owned timestamps. Existing messages are backfilled in created_at/UUID order; old migrations are unchanged.

Event mutations hold the existing event lock, advance the details stream and insert a viewer-independent snapshot in the same transaction. Actual no-ops allocate nothing. Sending a new message advances the message stream, saves its sequence and enqueues the message atomically; identical UUID/body retries do not allocate again. Membership and chat writes use the same lock. These guarantees apply to application writes; direct SQL writes must explicitly maintain streams/outbox too.

## Protocol

`GET /ws` upgrades to WebSocket. Identity comes from the server's configured demo user, never a client-supplied user ID. This is development identity, not authentication. Each connection supports up to 32 authorized targets.

```json
{"type":"subscribe","request_id":"1","target_type":"event_details","target_id":"EVENT_UUID"}
{"type":"subscribed","request_id":"1","target_type":"event_details","target_id":"EVENT_UUID"}
{"type":"update","id":"OUTBOX_UUID","target_type":"event_details","target_id":"EVENT_UUID","sequence":"14","payload":{}}
```

`unsubscribe` removes that target and returns `unsubscribed`. `ping` receives `pong`. `error` includes `code` (`forbidden`, `not_found`, `invalid_target`, `invalid_command`, `subscription_limit`, or `unavailable`). `resync` asks the feature to reload authoritative state. Fields unrelated to a frame may be omitted or null. Sequences use decimal strings to preserve bigint precision.

Details payloads match GET /events/{id} except viewer fields are omitted; the client derives its flags from its own viewer ID and the roster. Chat payloads match individual history messages. The server checks authorization again before writing each update; detail changes also wake chat to reconcile membership and read-only status.

Subscribe before loading state. Buffer details received during the initial request, choose the newest sequence, and preserve the scroll position. Reconnecting clients reload a consistent details snapshot. Chat recovers through GET /events/{id}/messages?after_sequence=N, draining pages while has_more. New contiguous socket messages merge by ID/sequence; duplicates are ignored and gaps trigger HTTP recovery. A larger chat sequence never replaces older messages. UUID retries and drafts remain intact. HTTP writes remain the source of validation and transaction rules.

## Delivery and recovery

The outbox dispatcher uses short row-locked transactions with SKIP LOCKED. Publication is PostgreSQL LISTEN/NOTIFY carrying only the outbox UUID, atomically committed with published_at. Every API instance loads the durable payload and broadcasts locally. This supplies cross-instance fanout without a separate Redis service; PostgreSQL is the current broker boundary. A future broker can replace this transport without changing the feature protocol or frozen schema.

Writes notify the dispatcher after commit; a one-second sweep also recovers pending entries. Failed publications schedule bounded exponential retries using next_attempt_at. Delivery may repeat and concurrent workers may publish out of order; feature sequences and HTTP recovery handle this. published_at means published to the fanout system, not acknowledged by every phone. Losing the database listener closes active sockets and wakes fallback requests, forcing reconciliation after reconnect. Outbox retention/deletion is not enabled; pending rows must never be deleted, and published-row retention needs a deployment policy.

## Lifecycle, limits and fallback

One frontend provider owns the connection and target subscriptions. It disconnects in background or when no targets remain. Reconnect uses backoff/jitter and restores subscriptions on foreground. Application ping/pong detects dead connections; the server also uses protocol pings every 20 seconds and a 60-second read deadline. Client handshake timeout is 10 seconds.

Client commands are at most 4 KiB; the server limits commands per connection to 40/second. Each connection has a bounded 64-frame queue and five-second write deadlines. Saturated clients disconnect and recover; they cannot grow the queue indefinitely. Outgoing frames are bounded to 64 KiB; larger snapshots produce resync and use HTTP. Files remain on HTTP. Future ephemeral signals should bypass the durable outbox.

After three failed socket connections, the client uses GET /realtime long polling, with one outstanding request per target. Requests wait up to 20 seconds, then return a snapshot or 204. Permissions are checked on every snapshot; membership/cancellation changes wake chat even when its message sequence is unchanged. The client probes WebSocket again after 60 seconds. Failed fallback requests back off and are aborted on background/unsubscribe.

Deploy through HTTPS/WSS on port 443. Reverse proxies must forward Upgrade/Connection headers, disable buffering for /realtime, allow long-poll responses for at least 30 seconds, and keep WebSocket idle timeouts above 60 seconds. Browser connections use same-origin checks. Do not expose the configured demo identity as a production authentication mechanism.

## Verification

`make check` includes frontend transport tests. With TEST_DATABASE_URL set, Go integration tests use isolated schemas and verify transactional rollback, idempotent updates, two API instances, participant-only delivery, revocation, history recovery and long-poll wakeup. Run Go tests with -race for connection/subscription concurrency. Physical-device networks and real restrictive proxies need deployment testing.
