package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
	"joinme/backend/internal/geography"
	"joinme/backend/migrations"
)

// Bad new places are refused before anything touches the database.
func TestInvalidPinnedPlace(t *testing.T) {
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	event := func(place string) string {
		return fmt.Sprintf(`{%s,"title":"Chai","type":"meetup","starts_at":%q,"capacity":4}`, place, future)
	}
	pin := func(fields string) string { return event(`"new_place":{` + fields + `}`) }
	for _, body := range []string{
		event(`"place_id":"00000000-0000-4000-8000-000000000100","new_place":{"name":"Chai Adda","kind":"cafe","coordinates":[74.35,31.51]}`),
		event(`"spot_id":"00000000-0000-4000-8000-000000000101","new_place":{"name":"Chai Adda","kind":"cafe","coordinates":[74.35,31.51]}`),
		pin(`"name":"C","kind":"cafe","coordinates":[74.35,31.51]`),
		pin(`"name":"` + strings.Repeat("a", 81) + `","kind":"cafe","coordinates":[74.35,31.51]`),
		pin(`"name":"Chai\nAdda","kind":"cafe","coordinates":[74.35,31.51]`),
		pin(`"name":"Chai Adda","coordinates":[74.35,31.51]`),
		pin(`"name":"Chai Adda","kind":"cafe","kind_text":"Dhaba","coordinates":[74.35,31.51]`),
		pin(`"name":"Chai Adda","kind":"other","coordinates":[74.35,31.51]`),
		pin(`"name":"Chai Adda","kind":"dhaba","coordinates":[74.35,31.51]`),
		pin(`"name":"Chai Adda","kind_text":"` + strings.Repeat("a", 41) + `","coordinates":[74.35,31.51]`),
		pin(`"name":"Chai Adda","kind":"cafe"`),
		pin(`"name":"Chai Adda","kind":"cafe","coordinates":[200,31.51]`),
		pin(`"name":"Chai Adda","kind":"cafe","coordinates":[74.35,31.51],"created_by":"someone"`),
	} {
		response := httptest.NewRecorder()
		Handler{}.CreateEvent(response, httptest.NewRequest("POST", "/events", strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("accepted %s: %d %s", body, response.Code, response.Body.String())
		}
	}
}

func TestPinnedPlaces(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL for PostGIS integration checks")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("pins_test_%d", time.Now().UnixNano())
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
	for _, seedPath := range []string{"../../seeds/lahore_districts.sql", "../../seeds/demo.sql"} {
		seed, err := os.ReadFile(seedPath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(seed)); err != nil {
			t.Fatalf("%s: %v", seedPath, err)
		}
	}
	var ali, sara pgtype.UUID
	ali.Scan("20000000-0000-4000-8000-000000000001")
	sara.Scan("20000000-0000-4000-8000-000000000002")
	queries := database.New(pool)
	future := time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)
	create := func(handler Handler, place string) *httptest.ResponseRecorder {
		body := fmt.Sprintf(`{"new_place":%s,"title":"Chai and chat","type":"meetup","starts_at":%q,"capacity":4}`, place, future)
		response := httptest.NewRecorder()
		handler.CreateEvent(response, httptest.NewRequest("POST", "/events", strings.NewReader(body)))
		return response
	}
	type stored struct {
		Slug, Type, District, Source, Review string
		KindText                             *string
		CreatedBy                            pgtype.UUID
	}
	placeOf := func(response *httptest.ResponseRecorder) stored {
		t.Helper()
		var created struct {
			ID string `json:"id"`
		}
		if response.Code != 201 || json.Unmarshal(response.Body.Bytes(), &created) != nil {
			t.Fatalf("creation: %d %s", response.Code, response.Body.String())
		}
		var place stored
		err := pool.QueryRow(ctx, `SELECT places.slug, places.type::text, district.slug, places.source::text,
                places.review_status::text, places.kind_text, places.created_by
            FROM events JOIN places ON places.id = events.place_id JOIN areas AS district ON district.id = places.area_id
            WHERE events.id = $1`, created.ID).
			Scan(&place.Slug, &place.Type, &place.District, &place.Source, &place.Review, &place.KindText, &place.CreatedBy)
		if err != nil {
			t.Fatal(err)
		}
		return place
	}
	countPlaces := func() (count int) {
		pool.QueryRow(ctx, `SELECT count(*) FROM places WHERE source = 'user'`).Scan(&count)
		return
	}

	limited := Handler{Queries: queries, Pool: pool, DemoUserID: ali, DailyEventLimit: 2}
	// A public pin in Gulberg: unreviewed, no creator stored, slug from its name.
	public := placeOf(create(limited, `{"name":"Chai Adda","kind":"cafe","coordinates":[74.3456,31.5104]}`))
	if public.Slug != "chai-adda" || public.Type != "cafe" || public.District != "gulberg" || public.Source != "user" ||
		public.Review != "unreviewed" || public.KindText != nil || public.CreatedBy.Valid {
		t.Fatalf("public pin: %+v", public)
	}
	var newPlace bool
	if err = pool.QueryRow(ctx, `SELECT (details->>'new_place')::boolean FROM activities
        WHERE action = 'event_created' ORDER BY occurred_at DESC LIMIT 1`).Scan(&newPlace); err != nil || !newPlace {
		t.Fatalf("event_created should say new_place: %v %v", newPlace, err)
	}
	// An event knows its place's slug and district, so the app can land on it in Explore.
	var latest string
	pool.QueryRow(ctx, `SELECT id::text FROM events ORDER BY created_at DESC LIMIT 1`).Scan(&latest)
	mux := http.NewServeMux()
	mux.HandleFunc("GET /events/{id}", limited.GetEvent)
	shown := httptest.NewRecorder()
	mux.ServeHTTP(shown, httptest.NewRequest("GET", "/events/"+latest, nil))
	var withPlace struct {
		Place struct {
			Slug     string `json:"slug"`
			District struct {
				Slug string `json:"slug"`
				Name string `json:"name"`
			} `json:"district"`
		} `json:"place"`
	}
	if json.Unmarshal(shown.Body.Bytes(), &withPlace) != nil || withPlace.Place.Slug != "chai-adda" ||
		withPlace.Place.District.Slug != "gulberg" || withPlace.Place.District.Name != "Gulberg" {
		t.Fatalf("event place: %s", shown.Body.String())
	}
	// The same name nearby, private, with a typed kind: its own slug, and it remembers who made it.
	private := placeOf(create(limited, `{"name":"Chai Adda","kind_text":"Rooftop","coordinates":[74.3457,31.5105],"private":true}`))
	if private.Slug != "chai-adda-2" || private.Type != "other" || private.KindText == nil || *private.KindText != "Rooftop" ||
		private.CreatedBy != ali {
		t.Fatalf("private pin: %+v", private)
	}
	// A third plan the same day is refused, and no place is left behind.
	before := countPlaces()
	if response := create(limited, `{"name":"Third Spot","kind":"park","coordinates":[74.3456,31.5104]}`); response.Code != http.StatusTooManyRequests ||
		!strings.Contains(response.Body.String(), "2 plans a day") {
		t.Fatalf("third plan: %d %s", response.Code, response.Body.String())
	}
	if countPlaces() != before {
		t.Fatal("a refused plan left a place behind")
	}
	// Someone else is not limited by Ali's plans; a pin outside Lahore is refused.
	other := Handler{Queries: queries, Pool: pool, DemoUserID: sara, DailyEventLimit: 2}
	if response := create(other, `{"name":"Sea View","kind":"park","coordinates":[67.03,24.80]}`); response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("outside Lahore: %d %s", response.Code, response.Body.String())
	}
	if countPlaces() != before {
		t.Fatal("a pin outside Lahore left a place behind")
	}

	// Private places show only to whoever made them: in the picker, search and the duplicate check.
	get := func(viewer pgtype.UUID, path string) string {
		handler := geography.Handler{Queries: queries, DemoUserID: viewer}
		mux := http.NewServeMux()
		mux.HandleFunc("GET /cities/{city}/places", handler.ListPickerPlaces)
		mux.HandleFunc("GET /cities/{city}/places/search", handler.SearchPlaces)
		mux.HandleFunc("GET /cities/{city}/places/nearby", handler.PlacesNear)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 200 {
			t.Fatalf("%s: %d %s", path, response.Code, response.Body.String())
		}
		return response.Body.String()
	}
	for _, path := range []string{"/cities/lahore/places", "/cities/lahore/places/search?q=chai+adda",
		"/cities/lahore/places/nearby?lng=74.3456&lat=31.5104&q=chai+ada"} {
		if mine, theirs := get(ali, path), get(sara, path); !strings.Contains(mine, "Rooftop") || strings.Contains(theirs, "Rooftop") ||
			!strings.Contains(theirs, `"Chai Adda"`) {
			t.Fatalf("%s: private place visibility wrong\nmine: %.300s\ntheirs: %.300s", path, mine, theirs)
		}
	}
	var near struct {
		District *struct {
			Slug string `json:"slug"`
		} `json:"district"`
		Places []struct {
			Name     string  `json:"name"`
			Distance float64 `json:"distance_m"`
		} `json:"places"`
	}
	json.Unmarshal([]byte(get(sara, "/cities/lahore/places/nearby?lng=74.3456&lat=31.5104&q=chai+ada")), &near)
	if near.District == nil || near.District.Slug != "gulberg" || len(near.Places) != 1 || near.Places[0].Distance > 150 {
		t.Fatalf("nearby in Gulberg: %+v", near)
	}
	// No name yet: just the district. Too far away or another name: no duplicates. Outside Lahore: no district.
	for path, district := range map[string]bool{
		"/cities/lahore/places/nearby?lng=74.3456&lat=31.5104":               true,
		"/cities/lahore/places/nearby?lng=74.3456&lat=31.5104&q=biryani+hub": true,
		"/cities/lahore/places/nearby?lng=74.3700&lat=31.5104&q=chai+adda":   true,
		"/cities/lahore/places/nearby?lng=67.03&lat=24.80&q=chai+adda":       false,
	} {
		near.District, near.Places = nil, nil
		json.Unmarshal([]byte(get(sara, path)), &near)
		if (near.District != nil) != district || len(near.Places) != 0 {
			t.Fatalf("%s: %+v", path, near)
		}
	}
	// A rejected place becomes private to whoever pinned it, keeping its events.
	if _, err = pool.Exec(ctx, `UPDATE places SET review_status = 'rejected', created_by = $1 WHERE slug = 'chai-adda'`, ali); err != nil {
		t.Fatal(err)
	}
	if theirs := get(sara, "/cities/lahore/places/search?q=chai+adda"); strings.Contains(theirs, `"Chai Adda"`) {
		t.Fatalf("a rejected place is still public: %.300s", theirs)
	}
	// Database rules: a typed kind only with type other, and only pinned places can be private.
	for _, statement := range []string{
		`UPDATE places SET kind_text = 'Dhaba' WHERE slug = 'chai-adda'`,
		`UPDATE places SET kind_text = NULL WHERE slug = 'chai-adda-2'`,
		`UPDATE places SET created_by = '20000000-0000-4000-8000-000000000001' WHERE id = '00000000-0000-4000-8000-000000000100'`,
	} {
		if _, err := pool.Exec(ctx, statement); err == nil {
			t.Fatalf("accepted: %s", statement)
		}
	}
}
