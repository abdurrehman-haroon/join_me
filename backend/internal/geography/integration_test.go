package geography

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
	"joinme/backend/migrations"
)

func TestPostGISMapFlow(t *testing.T) {
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
	// Every run owns a fresh schema; existing application data is untouched.
	schema := fmt.Sprintf("map_test_%d", time.Now().UnixNano())
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
	if err = migrations.Apply(ctx, pool); err != nil {
		t.Fatalf("second migration run: %v", err)
	}
	var versions int
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&versions); err != nil || versions != 14 {
		t.Fatalf("migration count %d: %v", versions, err)
	}

	var reportsRemoved bool
	if err = pool.QueryRow(ctx, `SELECT
		to_regclass(format('%I.reports', current_schema())) IS NULL
		AND to_regclass(format('%I.moderation_log', current_schema())) IS NULL
	`).Scan(&reportsRemoved); err != nil || !reportsRemoved {
		t.Fatalf("legacy reporting schema remains: %v", err)
	}

	t.Run("events and repeatable demo data", func(t *testing.T) {
		seed, err := os.ReadFile("../../seeds/demo.sql")
		if err != nil {
			t.Fatal(err)
		}
		for range 2 {
			if _, err = pool.Exec(ctx, string(seed)); err != nil {
				t.Fatal(err)
			}
		}
		var users, events, participants, statuses int
		err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM events),
            (SELECT count(*) FROM event_participants), (SELECT count(*) FROM status)`).Scan(&users, &events, &participants, &statuses)
		if err != nil || users != 6 || events != 5 || participants != 11 || statuses != 3 {
			t.Fatalf("demo counts: users=%d events=%d participants=%d statuses=%d: %v", users, events, participants, statuses, err)
		}
		var full bool
		err = pool.QueryRow(ctx, `SELECT count(*)=events.capacity FROM event_participants
            JOIN events ON events.id=event_id WHERE events.id='30000000-0000-4000-8000-000000000002'
            GROUP BY events.capacity`).Scan(&full)
		if err != nil || !full {
			t.Fatalf("full demo event: %v", err)
		}
		var hostID, placeID, statusID pgtype.UUID
		err = pool.QueryRow(ctx, `SELECT host_id,place_id,status_id FROM events
            WHERE id='30000000-0000-4000-8000-000000000001'`).Scan(&hostID, &placeID, &statusID)
		if err != nil {
			t.Fatal(err)
		}
		params := database.CreateEventParams{
			HostID: hostID, PlaceID: placeID, StatusID: statusID, Title: "Test event",
			Type: "football", StartsAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, Capacity: 1,
		}
		event, err := database.New(pool).CreateEvent(ctx, params)
		if err != nil {
			t.Fatal(err)
		}
		var hostJoined bool
		err = pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM event_participants WHERE event_id=$1 AND user_id=$2)`, event.ID, hostID).Scan(&hostJoined)
		if err != nil || !hostJoined || !event.CreatedAt.Time.Equal(event.UpdatedAt.Time) {
			t.Fatalf("atomic event and host creation: %v", err)
		}
		for _, check := range []struct{ statement, code string }{
			{`INSERT INTO event_participants(event_id,user_id) SELECT event_id,user_id FROM event_participants LIMIT 1`, "23505"},
			{`INSERT INTO status(statusable_type,name,slug) VALUES ('event','Duplicate','scheduled')`, "23505"},
			{`UPDATE events SET capacity=0`, "23514"},
			{`UPDATE events SET title=' '`, "23514"},
			{`UPDATE events SET type=' '`, "23514"},
			{`UPDATE status SET statusable_type='unknown'`, "22P02"},
			{`UPDATE events SET status_id='ffffffff-ffff-4fff-8fff-ffffffffffff'`, "23503"},
		} {
			_, err = pool.Exec(ctx, check.statement)
			var postgresError *pgconn.PgError
			if !errors.As(err, &postgresError) || postgresError.Code != check.code {
				t.Fatalf("expected %s for %s: %v", check.code, check.statement, err)
			}
		}
	})

	// Users need only a name; UUIDs and timestamps are database-owned defaults.
	var userID string
	var userCreated, userUpdated time.Time
	err = pool.QueryRow(ctx, `INSERT INTO users(display_name,created_at,updated_at)
        VALUES ('Ali','2000-01-01','2000-01-01') RETURNING id,created_at,updated_at`).Scan(&userID, &userCreated, &userUpdated)
	if err != nil || userID == "" || userCreated.Year() == 2000 || !userCreated.Equal(userUpdated) {
		t.Fatalf("minimal user insert: %v", err)
	}
	var userCreatedAfter, userUpdatedAfter time.Time
	err = pool.QueryRow(ctx, `UPDATE users SET display_name='Ahmed',created_at='2000-01-01',updated_at='2000-01-01'
        WHERE id=$1 RETURNING created_at,updated_at`, userID).Scan(&userCreatedAfter, &userUpdatedAfter)
	if err != nil || !userCreatedAfter.Equal(userCreated) || !userUpdatedAfter.After(userUpdated) {
		t.Fatalf("user timestamp ownership: %v", err)
	}
	for _, statement := range []string{
		`INSERT INTO users(display_name) VALUES ('   ')`,
		`INSERT INTO users DEFAULT VALUES`,
	} {
		if _, err = pool.Exec(ctx, statement); err == nil {
			t.Fatal("user without a nonblank name was accepted")
		}
	}

	// Invalid categories must fail as PostgreSQL enum input, not a text CHECK.
	for _, statement := range []string{
		`INSERT INTO areas(name,type) VALUES ('Invalid area','unknown')`,
		`UPDATE places SET type='unknown'`,
	} {
		_, err = pool.Exec(ctx, statement)
		var postgresError *pgconn.PgError
		if !errors.As(err, &postgresError) || postgresError.Code != "22P02" {
			t.Fatalf("expected enum input rejection: %v", err)
		}
	}

	// Every table, including the ledger and old product tables, has the timestamp trigger.
	var unmanaged int
	err = pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.tables AS tables
        WHERE table_schema=$1 AND table_type='BASE TABLE' AND NOT EXISTS (
            SELECT 1 FROM information_schema.triggers WHERE event_object_schema=$1
            AND event_object_table=tables.table_name AND trigger_name='manage_timestamps')`, schema).Scan(&unmanaged)
	if err != nil || unmanaged != 0 {
		t.Fatalf("tables missing timestamp management %d: %v", unmanaged, err)
	}
	var placeID string
	var created, updated time.Time
	err = pool.QueryRow(ctx, `INSERT INTO places (area_id,name,slug,type,location,created_at,updated_at)
		VALUES ('00000000-0000-4000-8000-000000000102','Test campus','test-campus','campus',ST_SetSRID(ST_Point(74.41,31.47),4326),'2000-01-01','2000-01-01')
        RETURNING id,created_at,updated_at`).Scan(&placeID, &created, &updated)
	if err != nil || created.Year() == 2000 || !created.Equal(updated) {
		t.Fatalf("insert timestamp ownership: %v", err)
	}
	var createdAfter, updatedAfter time.Time
	err = pool.QueryRow(ctx, `UPDATE places SET name='Renamed court',created_at='2000-01-01',updated_at='2000-01-01' WHERE id=$1 RETURNING created_at,updated_at`, placeID).Scan(&createdAfter, &updatedAfter)
	if err != nil || !createdAfter.Equal(created) || !updatedAfter.After(updated) {
		t.Fatalf("update timestamp ownership: %v", err)
	}

	_, err = pool.Exec(ctx, `UPDATE schema_migrations SET checksum='changed' WHERE version='000001_init.up.sql'`)
	if err != nil {
		t.Fatal(err)
	}
	if err = migrations.Apply(ctx, pool); err == nil || !strings.Contains(err.Error(), "was modified") {
		t.Fatalf("modified migration not rejected: %v", err)
	}
}

func TestExploreFlow(t *testing.T) {
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
	schema := fmt.Sprintf("explore_test_%d", time.Now().UnixNano())
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
	// Sample events must stay repeatable, like the other development seeds.
	for _, seedPath := range []string{"../../seeds/lahore_catalog.sql", "../../seeds/demo.sql", "../../seeds/lahore_sample_events.sql", "../../seeds/lahore_sample_events.sql"} {
		seed, err := os.ReadFile(seedPath)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = pool.Exec(ctx, string(seed)); err != nil {
			t.Fatalf("%s: %v", seedPath, err)
		}
	}
	var sampleEvents, sampleParticipants int
	err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM events WHERE id::text LIKE '40000000-%'),
        (SELECT count(*) FROM event_participants WHERE event_id::text LIKE '40000000-%')`).Scan(&sampleEvents, &sampleParticipants)
	if err != nil || sampleEvents != 40 || sampleParticipants != 122 {
		t.Fatalf("sample seed: events=%d participants=%d: %v", sampleEvents, sampleParticipants, err)
	}
	// Catalog outlines are illustrative but must contain every place in their district.
	var placesOutsideDistrict int
	err = pool.QueryRow(ctx, `SELECT count(*) FROM places JOIN areas AS districts ON districts.id = places.area_id
        WHERE districts.boundary IS NULL OR NOT ST_Contains(districts.boundary, places.location)`).Scan(&placesOutsideDistrict)
	if err != nil || placesOutsideDistrict != 0 {
		t.Fatalf("places outside their district outline: %d (%v)", placesOutsideDistrict, err)
	}
	// An event beyond the seven-day window must not count as coming up.
	_, err = pool.Exec(ctx, `INSERT INTO events (host_id, place_id, status_id, title, type, starts_at, capacity)
        VALUES ('20000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000100',
        '10000000-0000-4000-8000-000000000001', 'Too far ahead', 'football', statement_timestamp() + interval '10 days', 4)`)
	if err != nil {
		t.Fatal(err)
	}

	handler := Handler{Queries: database.New(pool)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /cities/{city}/districts", handler.ListCityDistricts)
	mux.HandleFunc("GET /cities/{city}/districts/{district}/places", handler.ListDistrictPlaces)
	mux.HandleFunc("GET /cities/{city}/districts/{district}/places/{place}", handler.GetPlace)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/cities/lahore/districts", nil))
	var cityFeed struct {
		City struct {
			Slug string
			Bbox []float64
		}
		WindowEndsAt time.Time `json:"window_ends_at"`
		Districts    []struct {
			Slug               string
			Bbox               []float64
			Boundary           json.RawMessage
			PlaceCount         int             `json:"place_count"`
			UpcomingEventCount int             `json:"upcoming_event_count"`
			FirstUp            json.RawMessage `json:"first_up"`
		}
	}
	if err = json.Unmarshal(response.Body.Bytes(), &cityFeed); err != nil || response.Code != 200 {
		t.Fatalf("city feed: %d %s (%v)", response.Code, response.Body.String(), err)
	}
	if cityFeed.City.Slug != "lahore" || len(cityFeed.City.Bbox) != 4 || len(cityFeed.Districts) != 13 || cityFeed.Districts[0].Slug != "dha-phase-1" {
		t.Fatalf("city feed shape: %s", response.Body.String())
	}
	if window := time.Until(cityFeed.WindowEndsAt); window < 6*24*time.Hour || window > 7*24*time.Hour {
		t.Fatalf("window ends in %s", window)
	}
	upcomingInCity := 0
	for _, district := range cityFeed.Districts {
		upcomingInCity += district.UpcomingEventCount
		if len(district.Bbox) != 4 || string(district.Boundary) == "null" {
			t.Fatalf("district %s has no map frame or outline", district.Slug)
		}
		if district.Slug == "dha-phase-5" && (district.PlaceCount != 2 || district.UpcomingEventCount != 10 || string(district.FirstUp) == "null") {
			t.Fatalf("DHA Phase 5 summary: %+v", district)
		}
	}
	// 40 sample events plus the three scheduled upcoming demo events at LUMS.
	if upcomingInCity != 43 {
		t.Fatalf("upcoming events in Lahore: %d", upcomingInCity)
	}

	// Carousels are capped per place while the count stays exact.
	_, err = pool.Exec(ctx, `INSERT INTO events (host_id, place_id, status_id, title, type, starts_at, capacity)
        SELECT '20000000-0000-4000-8000-000000000001', id, '10000000-0000-4000-8000-000000000001',
        'Extra walk '||number, 'walk', statement_timestamp() + number * interval '1 hour', 4
        FROM places, generate_series(1, 25) AS number WHERE slug = 'doongi-ground'`)
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/cities/lahore/districts/model-town/places", nil))
	var districtFeed struct {
		District struct {
			Slug string
			City struct{ Slug string }
			Bbox []float64
		}
		Places []struct {
			Slug               string
			Coordinates        []float64
			UpcomingEventCount int `json:"upcoming_event_count"`
			Events             []json.RawMessage
		}
	}
	if err = json.Unmarshal(response.Body.Bytes(), &districtFeed); err != nil || response.Code != 200 || len(districtFeed.Places) != 4 {
		t.Fatalf("district feed: %d %s (%v)", response.Code, response.Body.String(), err)
	}
	doongi := districtFeed.Places[3]
	if doongi.Slug != "doongi-ground" || districtFeed.District.City.Slug != "lahore" || len(districtFeed.District.Bbox) != 4 || len(doongi.Coordinates) != 2 || doongi.UpcomingEventCount != 26 || len(doongi.Events) != 20 {
		t.Fatalf("capped place carousel: count=%d events=%d", doongi.UpcomingEventCount, len(doongi.Events))
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/cities/lahore/districts/dha-phase-5/places/lums", nil))
	var placeView struct {
		Place struct {
			Slug     string
			District struct{ Slug string }
		}
		Spots     []struct{ Slug string }
		Truncated bool
		Events    []struct {
			Title string
			Spot  *struct{ Name string }
		}
	}
	if err = json.Unmarshal(response.Body.Bytes(), &placeView); err != nil || response.Code != 200 {
		t.Fatalf("place view: %d %s (%v)", response.Code, response.Body.String(), err)
	}
	if placeView.Place.District.Slug != "dha-phase-5" || len(placeView.Spots) != 6 || len(placeView.Events) != 8 || placeView.Truncated {
		t.Fatalf("LUMS view: spots=%d events=%d truncated=%t", len(placeView.Spots), len(placeView.Events), placeView.Truncated)
	}
	for _, event := range placeView.Events {
		if event.Spot == nil || event.Title == "Too far ahead" {
			t.Fatalf("LUMS event without spot or outside window: %+v", event)
		}
	}

	for _, path := range []string{
		"/cities/karachi/districts",
		"/cities/dha-phase-5/districts",
		"/cities/lahore/districts/nowhere/places",
		"/cities/lahore/districts/gulberg/places/lums",
		"/cities/lahore/districts/dha-phase-5/places/nowhere",
	} {
		response = httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != http.StatusNotFound {
			t.Fatalf("%s: got %d", path, response.Code)
		}
	}
}
