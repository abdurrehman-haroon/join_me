# Repository guidance for Codex

Read `docs/project.md`, `docs/plan.md`, `docs/handoff.md`, and `openapi.yaml` before changing product behavior or API code. Treat those tracked files as the shared context for both developers and assistants.

Use `frontend/AGENTS.md` for Expo work. Keep `openapi.yaml` aligned with any API change. Run `make check` before handing off work. Update `docs/handoff.md` after a meaningful change, and update `docs/plan.md` when the agreed sequence changes.

Work on a feature branch. Do not commit secrets or personal assistant transcripts.
