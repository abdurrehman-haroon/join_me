package osmplaces

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/migrations"
)

func TestChooseName(t *testing.T) {
	for _, test := range []struct {
		tags map[string]string
		want string
	}{
		{map[string]string{"name": "Model Town Park"}, "Model Town Park"},
		{map[string]string{"name": "قذافی اسٹیڈیم", "name:en": "Gaddafi Stadium"}, "Gaddafi Stadium"},
		{map[string]string{"name": "جلو پارک", "official_name:en": "Jallo Forest and Wildlife Park"}, "Jallo Forest and Wildlife Park"},
		{map[string]string{"name": "  Cosa   Nostra "}, "Cosa Nostra"},
		{map[string]string{"name": "بھٹی تکہ شاپ"}, ""},
		{map[string]string{"name": "123"}, ""},
	} {
		if got := ChooseName(test.tags); got != test.want {
			t.Errorf("ChooseName(%v) = %q, want %q", test.tags, got, test.want)
		}
	}
}

func TestTypeFor(t *testing.T) {
	for _, test := range []struct {
		tags map[string]string
		want string
	}{
		{map[string]string{"amenity": "fast_food"}, "restaurant"},
		{map[string]string{"leisure": "pitch"}, "sports_club"},
		{map[string]string{"amenity": "university"}, "campus"},
		{map[string]string{"historic": "tomb"}, "heritage"},
		// amenity wins over leisure, in tagKeys order.
		{map[string]string{"amenity": "cafe", "leisure": "park"}, "cafe"},
		{map[string]string{"amenity": "bank"}, ""},
	} {
		if got := TypeFor(test.tags); got != test.want {
			t.Errorf("TypeFor(%v) = %q, want %q", test.tags, got, test.want)
		}
	}
}

func TestSlugify(t *testing.T) {
	for name, want := range map[string]string{
		"Faletti's Hotel":            "faletti-s-hotel",
		"Second Cup - Emporium Mall": "second-cup-emporium-mall",
		"  ":                         "place",
		"Café Barbera":               "caf-barbera",
		"DHA Sports Complex Ph 5":    "dha-sports-complex-ph-5",
	} {
		if got := Slugify(name); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestWayGeometry(t *testing.T) {
	square := []coordinate{{31.5, 74.3}, {31.5, 74.4}, {31.6, 74.4}, {31.5, 74.3}}
	if got := wayGeometry(square); !strings.HasPrefix(got, "POLYGON((") {
		t.Errorf("closed way: %s", got)
	}
	if got := wayGeometry(square[:3]); !strings.HasPrefix(got, "LINESTRING(") {
		t.Errorf("open way: %s", got)
	}
}

// TestSync runs a sync against a real database: adding, changing, moving to another
// district, going missing, coming back, and refusing a partial fetch.
func TestSync(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL to run PostGIS integration checks")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("osm_places_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	districts, err := os.ReadFile("../../seeds/lahore_districts.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(districts)); err != nil {
		t.Fatal(err)
	}

	// Two places named alike in Gulberg, one in Model Town, LUMS, and one outside Lahore.
	gulbergCafe := Place{OSMRef: "node/1", Name: "Second Cup", Type: "cafe", Geometry: "POINT(74.3459 31.5190)", Tags: map[string]string{"amenity": "cafe"}}
	gulbergCafeToo := Place{OSMRef: "node/2", Name: "Second Cup", Type: "cafe", Geometry: "POINT(74.3470 31.5200)", Tags: map[string]string{"amenity": "cafe"}}
	modelTownPark := Place{OSMRef: "way/3", Name: "Model Town Park", Type: "park",
		Geometry: "POLYGON((74.322 31.481,74.330 31.481,74.330 31.488,74.322 31.488,74.322 31.481))", Tags: map[string]string{"leisure": "park"}}
	lums := Place{OSMRef: "way/70017485", Name: "Lahore University of Management Sciences", Type: "campus",
		Geometry: "POINT(74.4095 31.4705)", Tags: map[string]string{"amenity": "university"}}
	outside := Place{OSMRef: "node/4", Name: "Far away", Type: "cafe", Geometry: "POINT(73.0 33.7)", Tags: map[string]string{"amenity": "cafe"}}

	result, err := Sync(ctx, pool, []Place{gulbergCafe, gulbergCafeToo, modelTownPark, lums, outside})
	if err != nil {
		t.Fatal(err)
	}
	if result.Added != 3 || result.Updated != 1 || result.Skipped != 1 || result.Missing != 0 {
		t.Fatalf("first sync: %+v", result)
	}
	slugOf := func(osmRef string) (slug, district, status string) {
		t.Helper()
		err := pool.QueryRow(ctx, `SELECT places.slug, areas.slug, places.status::text FROM places
            JOIN areas ON areas.id = places.area_id WHERE places.osm_ref = $1`, osmRef).Scan(&slug, &district, &status)
		if err != nil {
			t.Fatalf("%s: %v", osmRef, err)
		}
		return slug, district, status
	}
	if slug, district, _ := slugOf("node/1"); slug != "second-cup" || district != "gulberg" {
		t.Fatalf("first cafe: %s in %s", slug, district)
	}
	if slug, _, _ := slugOf("node/2"); slug != "second-cup-2" {
		t.Fatalf("second cafe: %s", slug)
	}
	if slug, district, _ := slugOf("way/70017485"); slug != "lums" || district != "dha-phase-5" {
		t.Fatalf("LUMS keeps its slug: %s in %s", slug, district)
	}
	var outlined bool
	if err = pool.QueryRow(ctx, `SELECT boundary IS NOT NULL FROM places WHERE osm_ref = 'way/3'`).Scan(&outlined); err != nil || !outlined {
		t.Fatalf("park outline: %v", err)
	}

	// The second cafe moves to Model Town, the park gains opening hours, and the
	// first cafe drops out of OSM. An unchanged rerun of the same data changes nothing.
	gulbergCafeToo.Geometry = "POINT(74.3250 31.4840)"
	modelTownPark.Tags = map[string]string{"leisure": "park", "opening_hours": "05:00-22:00"}
	result, err = Sync(ctx, pool, []Place{gulbergCafeToo, modelTownPark, lums})
	if err != nil {
		t.Fatal(err)
	}
	if result.Added != 0 || result.Updated != 2 || result.Missing != 1 {
		t.Fatalf("second sync: %+v", result)
	}
	if slug, district, _ := slugOf("node/2"); slug != "second-cup-2" || district != "model-town" {
		t.Fatalf("moved cafe keeps its slug: %s in %s", slug, district)
	}
	if _, _, status := slugOf("node/1"); status != "missing_from_osm" {
		t.Fatalf("dropped cafe: %s", status)
	}
	result, err = Sync(ctx, pool, []Place{gulbergCafeToo, modelTownPark, lums})
	if err != nil || result.Added != 0 || result.Updated != 0 || result.Missing != 0 {
		t.Fatalf("unchanged sync: %+v (%v)", result, err)
	}

	// The cafe comes back; a fetch under half the stored places is refused.
	result, err = Sync(ctx, pool, []Place{gulbergCafe, gulbergCafeToo, modelTownPark, lums})
	if err != nil || result.Updated != 1 {
		t.Fatalf("returning cafe: %+v (%v)", result, err)
	}
	if _, _, status := slugOf("node/1"); status != "active" {
		t.Fatalf("returned cafe: %s", status)
	}
	if _, err = Sync(ctx, pool, []Place{lums}); err == nil || !strings.Contains(err.Error(), "partial") {
		t.Fatalf("partial fetch accepted: %v", err)
	}

	// The seed file recreates the same places in a fresh database.
	seedPath := filepath.Join(t.TempDir(), "places.sql")
	written, err := WriteSeed(ctx, pool, seedPath)
	if err != nil || written != 4 {
		t.Fatalf("seed: %d (%v)", written, err)
	}
	seed, err := os.ReadFile(seedPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, `DELETE FROM places WHERE id <> '00000000-0000-4000-8000-000000000100'`); err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(seed)); err != nil {
		t.Fatal(err)
	}
	if slug, district, _ := slugOf("node/2"); slug != "second-cup-2" || district != "model-town" {
		t.Fatalf("seeded cafe: %s in %s", slug, district)
	}
}
