# Shared AI workflow

1. Start: read `docs/project.md`, `docs/plan.md`, and `docs/handoff.md`. Read `design/README.md` for design work, `openapi.yaml` for API work, and `frontend/AGENTS.md` for frontend work.
2. Work on a feature branch. Keep API changes aligned with `openapi.yaml`.
3. Finish: run `make check`. Keep `docs/project.md`, `docs/plan.md`, and `docs/handoff.md` current when decisions, scope, or implementation state change. Commit those updates with the work.

Never push to GitHub without asking the user first and receiving explicit approval for that specific push. Do not infer approval from earlier pushes or broad access.

Keep these files short and factual. Never commit secrets or chat transcripts.
