# Shared AI workflow

1. Start: read `docs/project.md`, `docs/plan.md`, and `docs/handoff.md`. Read `design/README.md` for design work, `openapi.yaml` for API work, and `frontend/AGENTS.md` for frontend work.
2. Work directly on `main`; do not create feature branches. Keep API changes aligned with `openapi.yaml`.
3. Finish: run `make check`. Keep `docs/project.md`, `docs/plan.md`, and `docs/handoff.md` current when decisions, scope, or implementation state change. Leave changes uncommitted for user review.
4. After frontend changes, reload the local development app and verify the updated screen in the simulator when available. Tell the user which server is running and how to reload it themselves.

Code quality, always: favor readable, explicit, domain-named code with the main flow visible. Avoid needless layers, helpers, hooks, interfaces, and unrelated refactors. Keep validation, authorization, errors, concurrency, SQL, and coordinates easy to trace; test behavior and review the diff for readability.

For UI work, treat `design/prototype/index.html` v6 as the acceptance reference for all phone screens, interactions, and movement. Follow `docs/v6-fidelity-plan.md`; do not substitute an approximate MapLibre or generic React Native screen. Keep simulated prototype behavior distinct from connected production behavior.

Before writing or reviewing code, read all of `docs/code-practice.md` and apply it. Documentation-only tasks can use the summary above.

Database schema changes use numbered, forward-only `*.up.sql` migrations. Apply each migration once and track applied versions; never edit an applied migration or add a down migration. Correct mistakes with a new migration.

Never commit or push automatically. Leave all work uncommitted and unpushed for user review. Only commit or push when the user explicitly requests that specific action after reviewing; do not infer approval from earlier actions or broad access.

Keep these files short and factual. Never commit secrets or chat transcripts.
