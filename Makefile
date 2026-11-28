.PHONY: context check api app install osm-places

context:
	@cat docs/project.md docs/plan.md docs/handoff.md

check:
	cd backend && go test ./...
	cd frontend && pnpm exec expo lint index.ts src && pnpm exec tsc --noEmit && pnpm run test:realtime && pnpm run test:activities && pnpm run test:look-around

api:
	cd backend && go run ./cmd/api

# Runs the weekly OpenStreetMap places job now and rewrites its seed file.
# Uses DATABASE_URL, or the local joinme database that startup.sh uses.
osm-places:
	cd backend && DATABASE_URL="$${DATABASE_URL:-postgres://$$(id -un)@127.0.0.1:5432/joinme?sslmode=disable}" go run ./cmd/osm-places

app:
	cd frontend && pnpm start

install:
	cd frontend && pnpm install --frozen-lockfile
