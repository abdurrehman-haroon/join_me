.PHONY: context check api app install

context:
	@cat docs/project.md docs/plan.md docs/handoff.md

check:
	cd backend && go test ./...
	cd frontend && pnpm exec expo lint App.tsx src && pnpm exec tsc --noEmit

api:
	cd backend && go run ./cmd/api

app:
	cd frontend && pnpm start

install:
	cd frontend && pnpm install --frozen-lockfile
