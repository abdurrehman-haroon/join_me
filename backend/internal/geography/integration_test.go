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
	if err = pool.QueryRow(ctx, "SELECT count(*) FROM schema_migrations").Scan(&versions); err != nil || versions != 5 {
		t.Fatalf("migration count %d: %v", versions, err)
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
