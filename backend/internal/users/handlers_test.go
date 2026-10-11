package users

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
	"joinme/backend/migrations"
)

func TestInvalidProfileUpdates(t *testing.T) {
	for _, body := range []string{`{}`, `null`, `{`, `{"display_name":"  "}`, `{"display_name":"hi","id":"other-user"}`, `{"display_name":"line\nname"}`, `{"display_name":"\u0000"}`, `{"display_name":"` + strings.Repeat("a", 101) + `"}`, `{"display_name":"name"} {}`} {
		response := httptest.NewRecorder()
		Handler{}.Me(response, httptest.NewRequest("PATCH", "/me", strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("invalid profile returned %d: %s", response.Code, response.Body.String())
		}
	}
}

func TestProfilePersistence(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set TEST_DATABASE_URL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("profile_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(url)
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
	var userID pgtype.UUID
	userID.Scan("20000000-0000-4000-8000-000000000001")
	handler := Handler{Queries: database.New(pool), DemoUserID: userID}
	call := func(method, body string, want int) map[string]json.RawMessage {
		t.Helper()
		response := httptest.NewRecorder()
		handler.Me(response, httptest.NewRequest(method, "/me", strings.NewReader(body)))
		if response.Code != want {
			t.Fatalf("%s: %d %s", method, response.Code, response.Body.String())
		}
		var profile map[string]json.RawMessage
		if want == 200 {
			if err = json.Unmarshal(response.Body.Bytes(), &profile); err != nil {
				t.Fatal(err)
			}
		}
		return profile
	}
	call("GET", "", 503)
	if _, err = pool.Exec(ctx, "INSERT INTO users(id,display_name) VALUES ($1,'Demo Ali')", userID); err != nil {
		t.Fatal(err)
	}
	before := call("GET", "", 200)
	after := call("PATCH", `{"display_name":"  علی  "}`, 200)
	if string(after["display_name"]) != `"علی"` || string(before["id"]) != string(after["id"]) || string(before["created_at"]) != string(after["created_at"]) {
		t.Fatalf("unexpected profile: %s", after)
	}
	if string(before["updated_at"]) == string(after["updated_at"]) {
		t.Fatal("updated_at did not advance")
	}
	loaded := call("GET", "", 200)
	if string(loaded["display_name"]) != `"علی"` {
		t.Fatal("name not persisted")
	}
	call("PATCH", `{"display_name":"  علی  "}`, 200)
	var otherID pgtype.UUID
	otherID.Scan("20000000-0000-4000-8000-000000000002")
	if _, err = pool.Exec(ctx, "INSERT INTO users(id,display_name) VALUES ($1,'Other user')", otherID); err != nil {
		t.Fatal(err)
	}
	var otherName string
	pool.QueryRow(ctx, "SELECT display_name FROM users WHERE id=$1", otherID).Scan(&otherName)
	if otherName != "Other user" {
		t.Fatal("changed another user")
	}
}
