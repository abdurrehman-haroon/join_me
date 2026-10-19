# Shared AI workflow

1. Start: read `docs/project.md`, `docs/plan.md`, and `docs/handoff.md`. Read `design/README.md` for design work, `openapi.yaml` for API work, and `frontend/AGENTS.md` for frontend work.
2. Work directly on `main`; do not create feature branches. Keep API changes aligned with `openapi.yaml`.
3. Finish: run `make check`. Keep `docs/project.md`, `docs/plan.md`, and `docs/handoff.md` current when decisions, scope, or implementation state change. Leave changes uncommitted for user review.
4. After frontend changes, reload the local development app and verify the updated screen in the simulator when available. Tell the user which server is running and how to reload it themselves.

Code quality, always: favor readable, explicit, domain-named code with the main flow visible. Avoid needless layers, helpers, hooks, interfaces, and unrelated refactors. Keep validation, authorization, errors, concurrency, SQL, and coordinates easy to trace; test behavior and review the diff for readability.

Current user-approved starting scope in `docs/plan.md` supersedes the earlier all-v6 fidelity milestone: use a real MapLibre map with OpenFreeMap tiles and build the slim LUMS pickup flow first. Preserve Floodlight styling; keep simulated prototype behavior distinct from connected production behavior. Discuss schema with the user, then frontend mechanics, before implementing each feature. `design/prototype/index.html` and `docs/v6-fidelity-plan.md` remain references for deferred features.

Before writing or reviewing code, read all of `docs/code-practice.md` and apply it. Documentation-only tasks can use the summary above.

Database schema changes use numbered, forward-only `*.up.sql` migrations. Apply each migration once and track applied versions; never edit an applied migration or add a down migration. Correct mistakes with a new migration. Every application table must have database-managed `created_at` and `updated_at`: set both on insertion, preserve `created_at` on updates, and refresh `updated_at` automatically.

Use PostgreSQL enums for fields with a fixed set of values, including type and status; never model these as text columns (even with CHECK constraints). Generate matching Go types with sqlc.

For every new or changed feature, explicitly assess whether activities should be stored and which ones support a useful product question or report. Record the decision (including when no tracking is needed) in the feature plan. For selected activities, define the action, exact trigger, actor, trackable, source, allowed details, historical context, recording owner and retry/deduplication behavior; reuse existing definitions where appropriate. Follow docs/activities.md. Discuss this during schema/frontend planning; do not automatically track every interaction or treat this rule as approval to implement the proposed activities system.

For every new or changed feature, discuss how its data should stay fresh to improve the user experience: WebSockets, polling (including long polling), a combination, or updates only on load/user action. Choose based on how quickly users need changes, expected update frequency, network/battery/server cost and access rules; do not automatically add realtime updates everywhere. Record the choice and reason in the feature plan during schema/frontend planning. Reuse the shared realtime connection and fallback where suitable, and define screen/background cleanup, reconnect recovery and stale/error behavior. Host signup insights are an example: event WebSocket updates trigger a host-authorized HTTP refresh, with long polling as transport fallback, while existing values remain visible.

Never commit or push automatically. Leave all work uncommitted and unpushed for user review. Only commit or push when the user explicitly requests that specific action after reviewing; do not infer approval from earlier actions or broad access.

Keep these files short and factual. Never commit secrets or chat transcripts.
