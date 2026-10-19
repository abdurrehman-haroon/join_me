.PHONY: context check api app install

context:
	@cat docs/project.md docs/plan.md docs/handoff.md

check:
	cd backend && go test ./...
	cd frontend && pnpm exec expo lint index.ts src && pnpm exec tsc --noEmit && pnpm run test:realtime && pnpm run test:activities

api:
	cd backend && go run ./cmd/api

app:
	cd frontend && pnpm start

install:
	cd frontend && pnpm install --frozen-lockfile
