// Command osm-places runs the weekly OpenStreetMap places job once, now, and
// rewrites seeds/lahore_osm_places.sql from the result. Run it from backend/
// (`make osm-places` does) with DATABASE_URL set.
package main

import (
	"context"
	"log"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/osmplaces"
	"joinme/backend/migrations"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required; see backend/README.md")
	}
	ctx := context.Background()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer pool.Close()
	if err = migrations.Apply(ctx, pool); err != nil {
		log.Fatalf("migrate database: %v", err)
	}

	places, skipped, err := osmplaces.Fetch(ctx)
	if err != nil {
		log.Fatal(err)
	}
	result, err := osmplaces.Sync(ctx, pool, places)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf("OSM places: fetched %d, skipped %d, added %d, updated %d, missing %d",
		result.Fetched, skipped+result.Skipped, result.Added, result.Updated, result.Missing)

	written, err := osmplaces.WriteSeed(ctx, pool, "seeds/lahore_osm_places.sql")
	if err != nil {
		log.Fatalf("write seed: %v", err)
	}
	log.Printf("Wrote %d places to seeds/lahore_osm_places.sql", written)
}
