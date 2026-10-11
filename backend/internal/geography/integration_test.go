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
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&versions); err != nil || versions != 8 {
		t.Fatalf("migration count %d: %v", versions, err)
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
			Type: database.EventTypeFootball, StartsAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, Capacity: 1,
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
			{`UPDATE events SET type='unknown'`, "22P02"},
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
	err = pool.QueryRow(ctx, `INSERT INTO places (area_id,name,type,location,created_at,updated_at)
        VALUES ('00000000-0000-4000-8000-000000000001','Test court','court',ST_SetSRID(ST_Point(74.41,31.47),4326),'2000-01-01','2000-01-01')
        RETURNING id,created_at,updated_at`).Scan(&placeID, &created, &updated)
	if err != nil || created.Year() == 2000 || !created.Equal(updated) {
		t.Fatalf("insert timestamp ownership: %v", err)
	}
	var createdAfter, updatedAfter time.Time
	err = pool.QueryRow(ctx, `UPDATE places SET name='Renamed court',created_at='2000-01-01',updated_at='2000-01-01' WHERE id=$1 RETURNING created_at,updated_at`, placeID).Scan(&createdAfter, &updatedAfter)
	if err != nil || !createdAfter.Equal(created) || !updatedAfter.After(updated) {
		t.Fatalf("update timestamp ownership: %v", err)
	}

	// Optional area outlines still allow opening a campus from its mapped places.
	var outlineFreeAreaID string
	err = pool.QueryRow(ctx, `INSERT INTO areas(name,type) VALUES ('Second campus','campus') RETURNING id`).Scan(&outlineFreeAreaID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = pool.Exec(ctx, `INSERT INTO places(area_id,name,type,location) VALUES ($1,'Second campus court','court',ST_SetSRID(ST_Point(73,33),4326))`, outlineFreeAreaID)
	if err != nil {
		t.Fatal(err)
	}

	handler := Handler{Queries: database.New(pool)}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /areas/{id}", handler.GetArea)
	mux.HandleFunc("GET /places", handler.ListPlaces)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/areas/00000000-0000-4000-8000-000000000001", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"name": "LUMS"`) {
		t.Fatalf("area: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/areas/ffffffff-ffff-4fff-8fff-ffffffffffff", nil))
	if response.Code != 404 {
		t.Fatalf("missing area: %d", response.Code)
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/areas/"+outlineFreeAreaID, nil))
	var outlineFreeArea struct {
		Bbox     []float64
		Boundary json.RawMessage
	}
	if err = json.Unmarshal(response.Body.Bytes(), &outlineFreeArea); err != nil || response.Code != 200 || len(outlineFreeArea.Bbox) != 4 || string(outlineFreeArea.Boundary) != "null" {
		t.Fatalf("optional outline: %s (%v)", response.Body.String(), err)
	}

	for _, check := range []struct {
		bounds string
		count  int
	}{{"74.40,31.46,74.42,31.48", 7}, {"0,0,1,1", 0}} {
		response = httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", "/places?bbox="+check.bounds, nil))
		var collection struct {
			Type      string
			Features  []json.RawMessage
			Truncated bool
		}
		if err = json.Unmarshal(response.Body.Bytes(), &collection); err != nil || response.Code != 200 || len(collection.Features) != check.count || collection.Truncated || collection.Type != "FeatureCollection" {
			t.Fatalf("viewport %s: %d %s (%v)", check.bounds, response.Code, response.Body.String(), err)
		}
	}
	_, err = pool.Exec(ctx, `INSERT INTO places (area_id,name,type,location) SELECT '00000000-0000-4000-8000-000000000001','Extra court '||number,'court',ST_SetSRID(ST_Point(74.41,31.47),4326) FROM generate_series(1,1001) AS number`)
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/places?bbox=74.40,31.46,74.42,31.48", nil))
	var limited struct {
		Features  []json.RawMessage
		Truncated bool
	}
	if err = json.Unmarshal(response.Body.Bytes(), &limited); err != nil || len(limited.Features) != 1000 || !limited.Truncated {
		t.Fatalf("viewport limit: %d, %t (%v)", len(limited.Features), limited.Truncated, err)
	}
	_, err = pool.Exec(ctx, `UPDATE schema_migrations SET checksum='changed' WHERE version='000001_init.up.sql'`)
	if err != nil {
		t.Fatal(err)
	}
	if err = migrations.Apply(ctx, pool); err == nil || !strings.Contains(err.Error(), "was modified") {
		t.Fatalf("modified migration not rejected: %v", err)
	}
}
