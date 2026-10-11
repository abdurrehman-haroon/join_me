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
	"joinme/backend/migrations"
)

func TestParticipantMessages(t *testing.T) {
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
	schema := fmt.Sprintf("messages_test_%d", time.Now().UnixNano())
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
	seed, err := os.ReadFile("../../seeds/demo.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(seed)); err != nil {
		t.Fatal(err)
	}
	var user pgtype.UUID
	user.Scan("20000000-0000-4000-8000-000000000001")
	handler := Handler{Queries: database.New(pool), Pool: pool, DemoUserID: user}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /events/{id}/messages", handler.Messages)
	mux.HandleFunc("POST /events/{id}/messages", handler.Messages)
	event := "30000000-0000-4000-8000-000000000001"
	path := "/events/" + event + "/messages"
	call := func(method, path, body string, want int) *httptest.ResponseRecorder {
		t.Helper()
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(method, path, strings.NewReader(body)))
		if response.Code != want {
			t.Fatalf("%s %s: got %d want %d: %s", method, path, response.Code, want, response.Body.String())
		}
		return response
	}
	body := `{"id":"40000000-0000-4000-8000-000000000001","body":"  Hello group  "}`
	call("POST", path, body, 204)
	call("POST", path, body, 204)
	call("POST", path, strings.Replace(body, "Hello group", "different", 1), 409)
	for _, invalid := range []string{`{}`, `null`, `{"id":"bad","body":"hello"}`, `{"id":"40000000-0000-4000-8000-000000000002","body":"   "}`, strings.Replace(body, "Hello group", strings.Repeat("x", 2001), 1), body + `{}`} {
		call("POST", path, invalid, 400)
	}
	response := call("GET", path, "", 200)
	var page struct {
		Messages []chatMessage `json:"messages"`
		HasMore  bool          `json:"has_more"`
		CanSend  bool          `json:"can_send"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &page); err != nil {
		t.Fatal(err)
	}
	if len(page.Messages) != 1 || page.Messages[0].Body != "Hello group" || page.Messages[0].DisplayName == "" || !page.CanSend {
		t.Fatalf("unexpected page: %+v", page)
	}
	firstCursor := page.Messages[0].Cursor
	call("GET", path+"?before=invalid", "", 400)
	call("GET", path+"?before="+firstCursor+"&after="+firstCursor, "", 400)
	// Equal timestamps exercise the UUID tie-breaker across page boundaries.
	_, err = pool.Exec(ctx, `INSERT INTO messages(id,event_id,user_id,body) SELECT ('50000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,$1,$2,'Message ' || n FROM generate_series(1,60) AS n`, event, user)
	if err != nil {
		t.Fatal(err)
	}
	response = call("GET", path, "", 200)
	json.Unmarshal(response.Body.Bytes(), &page)
	if len(page.Messages) != 50 || !page.HasMore {
		t.Fatalf("latest page: %d %v", len(page.Messages), page.HasMore)
	}
	olderCursor := page.Messages[0].Cursor
	response = call("GET", path+"?before="+olderCursor, "", 200)
	json.Unmarshal(response.Body.Bytes(), &page)
	if len(page.Messages) != 11 || page.HasMore {
		t.Fatalf("older page: %d %v", len(page.Messages), page.HasMore)
	}
	response = call("GET", path+"?after="+firstCursor, "", 200)
	json.Unmarshal(response.Body.Bytes(), &page)
	if len(page.Messages) != 50 || !page.HasMore {
		t.Fatal("catch-up first page")
	}
	response = call("GET", path+"?after="+page.Messages[49].Cursor, "", 200)
	json.Unmarshal(response.Body.Bytes(), &page)
	if len(page.Messages) != 10 || page.HasMore {
		t.Fatal("catch-up final page")
	}
	concurrentBody := `{"id":"60000000-0000-4000-8000-000000000001","body":"Concurrent retry"}`
	statuses := make(chan int, 2)
	for range 2 {
		go func() {
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest("POST", path, strings.NewReader(concurrentBody)))
			statuses <- response.Code
		}()
	}
	for range 2 {
		if code := <-statuses; code != 204 {
			t.Fatalf("concurrent retry: %d", code)
		}
	}
	var created, updated time.Time
	if err = pool.QueryRow(ctx, `SELECT created_at,updated_at FROM messages WHERE id='60000000-0000-4000-8000-000000000001'`).Scan(&created, &updated); err != nil {
		t.Fatal(err)
	}
	if created.IsZero() || updated.Before(created) {
		t.Fatal("missing automatic timestamps")
	}
	if _, err = pool.Exec(ctx, `UPDATE messages SET created_at='2000-01-01',updated_at='2000-01-01' WHERE id='60000000-0000-4000-8000-000000000001'`); err != nil {
		t.Fatal(err)
	}
	var preserved, refreshed time.Time
	pool.QueryRow(ctx, `SELECT created_at,updated_at FROM messages WHERE id='60000000-0000-4000-8000-000000000001'`).Scan(&preserved, &refreshed)
	if !preserved.Equal(created) || !refreshed.After(updated) {
		t.Fatal("timestamps not database-owned")
	}
	call("GET", "/events/30000000-0000-4000-8000-000000000005/messages", "", 403)
	call("POST", "/events/30000000-0000-4000-8000-000000000005/messages", body, 403)
	if _, err = pool.Exec(ctx, `UPDATE events SET status_id=(SELECT id FROM status WHERE slug='cancelled') WHERE id=$1`, event); err != nil {
		t.Fatal(err)
	}
	call("POST", path, body, 204)
	call("POST", path, strings.Replace(body, "000000000001", "000000000002", 1), 409)
	response = call("GET", path, "", 200)
	json.Unmarshal(response.Body.Bytes(), &page)
	if page.CanSend {
		t.Fatal("cancelled chat writable")
	}
	if _, err = pool.Exec(ctx, `UPDATE events SET status_id=(SELECT id FROM status WHERE slug='completed') WHERE id=$1`, event); err != nil {
		t.Fatal(err)
	}
	call("POST", path, strings.Replace(body, "000000000001", "000000000002", 1), 409)
	response = call("GET", path, "", 200)
	json.Unmarshal(response.Body.Bytes(), &page)
	if page.CanSend {
		t.Fatal("completed chat writable")
	}
	if _, err = pool.Exec(ctx, `DELETE FROM event_participants WHERE event_id=$1 AND user_id=$2`, event, user); err != nil {
		t.Fatal(err)
	}
	call("GET", path, "", 403)
	call("POST", path, body, 403)
	var count int
	pool.QueryRow(ctx, "SELECT count(*) FROM messages WHERE event_id=$1", event).Scan(&count)
	if count != 62 {
		t.Fatalf("history count %d", count)
	}
}
