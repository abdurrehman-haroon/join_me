package events

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/activities"
	"joinme/backend/internal/database"
	"joinme/backend/migrations"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestActivitiesAndSafeCreation(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL for database activity tests")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("activities_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, _ := pgxpool.ParseConfig(databaseURL)
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	seed, _ := os.ReadFile("../../seeds/demo.sql")
	if _, err = pool.Exec(ctx, string(seed)); err != nil {
		t.Fatal(err)
	}
	var host, attendee pgtype.UUID
	host.Scan("20000000-0000-4000-8000-000000000001")
	attendee.Scan("20000000-0000-4000-8000-000000000002")
	queries := database.New(pool)
	handler := Handler{Queries: queries, Pool: pool, DemoUserID: host}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /events", handler.CreateEvent)
	mux.HandleFunc("PATCH /events/{id}", handler.UpdateEvent)
	mux.HandleFunc("PUT /events/{id}/cancellation", handler.CancelEvent)
	mux.HandleFunc("PUT /events/{id}/participation", Handler{Queries: queries, Pool: pool, DemoUserID: attendee}.ChangeParticipation)
	mux.HandleFunc("DELETE /events/{id}/participation", Handler{Queries: queries, Pool: pool, DemoUserID: attendee}.ChangeParticipation)
	mux.HandleFunc("POST /activities", activities.Handler{Queries: queries, DemoUserID: host}.Ingest)
	call := func(method, path, body, key string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		if key != "" {
			request.Header.Set("X-Activity-ID", key)
			request.Header.Set("X-Activity-Session", "30000000-0000-4000-8000-000000000001")
			request.Header.Set("X-Activity-Interaction", "30000000-0000-4000-8000-000000000002")
		}
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, request)
		return response
	}
	key := "30000000-0000-4000-8000-000000000003"
	body := fmt.Sprintf(`{"place_id":"00000000-0000-4000-8000-000000000003","title":"Tracked","type":"football","starts_at":%q,"capacity":2}`, time.Now().Add(time.Hour).UTC().Format(time.RFC3339))
	responses := make(chan *httptest.ResponseRecorder, 2)
	var wait sync.WaitGroup
	for range 2 {
		wait.Add(1)
		go func() { defer wait.Done(); responses <- call("POST", "/events", body, key) }()
	}
	wait.Wait()
	close(responses)
	var eventID string
	for response := range responses {
		if response.Code != 201 {
			t.Fatalf("creation: %d %s", response.Code, response.Body.String())
		}
		var event struct {
			ID string `json:"id"`
		}
		json.Unmarshal(response.Body.Bytes(), &event)
		if eventID != "" && eventID != event.ID {
			t.Fatal("concurrent retry created another game")
		}
		eventID = event.ID
	}
	if response := call("POST", "/events", strings.Replace(body, "Tracked", "Changed", 1), key); response.Code != 409 {
		t.Fatalf("changed idempotency body: %d", response.Code)
	}
	joinKey := "30000000-0000-4000-8000-000000000004"
	for range 2 {
		if response := call("PUT", "/events/"+eventID+"/participation", "", joinKey); response.Code != 204 {
			t.Fatalf("join: %d %s", response.Code, response.Body.String())
		}
	}
	var count int
	pool.QueryRow(ctx, "SELECT count(*) FROM activities WHERE action='participation_joined' AND trackable_id=$1", eventID).Scan(&count)
	if count != 1 {
		t.Fatalf("duplicate success count: %d", count)
	}
	if response := call("DELETE", "/events/"+eventID+"/participation", "", "30000000-0000-4000-8000-000000000005"); response.Code != 204 {
		t.Fatal(response.Body.String())
	}
	// Replaying an accepted request must not silently rejoin after a later leave.
	call("PUT", "/events/"+eventID+"/participation", "", joinKey)
	pool.QueryRow(ctx, "SELECT count(*) FROM event_participants WHERE event_id=$1 AND user_id=$2", eventID, attendee).Scan(&count)
	if count != 0 {
		t.Fatal("old join replay rejoined")
	}
	// Receipt replay still works after the game's original kickoff.
	pool.Exec(ctx, "UPDATE events SET starts_at=now()-interval '1 hour' WHERE id=$1", eventID)
	if response := call("POST", "/events", body, key); response.Code != 201 {
		t.Fatal("could not replay existing creation")
	}
	rejectedKey := "30000000-0000-4000-8000-000000000006"
	for range 2 {
		if response := call("PUT", "/events/"+eventID+"/participation", "", rejectedKey); response.Code != 409 {
			t.Fatalf("closed join: %d", response.Code)
		}
	}
	pool.QueryRow(ctx, "SELECT count(*) FROM activities WHERE id=$1 AND action='join_rejected'", rejectedKey).Scan(&count)
	if count != 1 {
		t.Fatal("rejection receipt missing or duplicated")
	}

	makeActivity := func(id string, step int, action, details string) string {
		return fmt.Sprintf(`{"id":%q,"action":%q,"session_id":"40000000-0000-4000-8000-000000000001","interaction_id":"40000000-0000-4000-8000-000000000002","interaction_step":%d,"trackable_type":"place","trackable_id":"00000000-0000-4000-8000-000000000003","source":"event_form","occurred_at":%q,"details":%s}`,
			id, action, step, time.Now().UTC().Truncate(time.Millisecond).Format(time.RFC3339Nano), details)
	}
	first := makeActivity("40000000-0000-4000-8000-000000000003", 1, "event_creation_started", `{"elapsed_ms":0,"active_ms":0}`)
	second := makeActivity("40000000-0000-4000-8000-000000000004", 2, "event_creation_submitted", `{"elapsed_ms":90000,"active_ms":50000,"attempt_number":1}`)
	forged := makeActivity("40000000-0000-4000-8000-000000000005", 3, "event_created", `{"elapsed_ms":0,"active_ms":0}`)
	ingest := func(actor, rows string) *httptest.ResponseRecorder {
		return call("POST", "/activities", fmt.Sprintf(`{"actor_id":%q,"activities":[%s]}`, actor, rows), "")
	}
	// Late starts and a permanently invalid row must not block valid siblings.
	response := ingest(host.String(), second+","+first+","+forged)
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var reply struct {
		Results []struct {
			Status string `json:"status"`
		} `json:"results"`
	}
	json.Unmarshal(response.Body.Bytes(), &reply)
	if len(reply.Results) != 3 || reply.Results[0].Status != "accepted" || reply.Results[1].Status != "accepted" || reply.Results[2].Status != "rejected" {
		t.Fatal(response.Body.String())
	}
	for range 2 {
		response = ingest(host.String(), first)
		if !strings.Contains(response.Body.String(), `"accepted"`) {
			t.Fatal(response.Body.String())
		}
	}
	response = ingest(host.String(), strings.Replace(first, `"active_ms":0`, `"active_ms":1`, 1))
	if !strings.Contains(response.Body.String(), `"rejected"`) {
		t.Fatal("invalid timing accepted")
	}
	response = ingest(host.String(), strings.Replace(second, `"active_ms":50000`, `"active_ms":40000`, 1))
	if !strings.Contains(response.Body.String(), `"conflict"`) {
		t.Fatal("changed activity overwrote history")
	}
	if response = ingest(attendee.String(), first); response.Code != 409 {
		t.Fatal("queue changed actor")
	}
	var createdAt, updatedAt time.Time
	pool.QueryRow(ctx, "SELECT created_at,updated_at FROM activities WHERE id='40000000-0000-4000-8000-000000000003'").Scan(&createdAt, &updatedAt)
	if !createdAt.Equal(updatedAt) {
		t.Fatal("retry changed timestamps")
	}
	// Untargeted discovery rows use SQL NULLs and remain idempotent through ingestion.
	discovery := fmt.Sprintf(`{"id":"70000000-0000-4000-8000-000000000001","action":"sport_filter_selected","session_id":"70000000-0000-4000-8000-000000000002","interaction_id":"70000000-0000-4000-8000-000000000003","interaction_step":1,"trackable_type":null,"trackable_id":null,"source":"map","occurred_at":%q,"details":{"sport":"cricket"}}`, time.Now().UTC().Truncate(time.Millisecond).Format(time.RFC3339Nano))
	for range 2 {
		response = ingest(host.String(), discovery)
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"accepted"`) {
			t.Fatal(response.Body.String())
		}
	}
	var untargeted bool
	if err := pool.QueryRow(ctx, "SELECT trackable_type IS NULL AND trackable_id IS NULL FROM activities WHERE id='70000000-0000-4000-8000-000000000001'").Scan(&untargeted); err != nil || !untargeted {
		t.Fatalf("discovery target: %v %v", untargeted, err)
	}
	response = ingest(host.String(), strings.Replace(discovery, `"sport":"cricket"`, `"sport":"football"`, 1))
	if !strings.Contains(response.Body.String(), `"conflict"`) {
		t.Fatal("discovery retry changed history")
	}

	// Session starts have no invented screen interaction or entity, and reserve
	// their session UUID as their one stable activity identity.
	sessionStart := fmt.Sprintf(`{"id":"a0000000-0000-4000-8000-000000000001","action":"session_started","session_id":"a0000000-0000-4000-8000-000000000001","interaction_id":null,"interaction_step":null,"trackable_type":null,"trackable_id":null,"source":null,"occurred_at":%q,"details":{}}`, time.Now().UTC().Truncate(time.Millisecond).Format(time.RFC3339Nano))
	for range 2 {
		response = ingest(host.String(), sessionStart)
		if response.Code != 200 || !strings.Contains(response.Body.String(), `"accepted"`) {
			t.Fatal(response.Body.String())
		}
	}
	var sessionNulls bool
	if err := pool.QueryRow(ctx, `SELECT interaction_id IS NULL AND interaction_step IS NULL AND trackable_type IS NULL AND trackable_id IS NULL AND source IS NULL AND details='{}'::jsonb FROM activities WHERE id='a0000000-0000-4000-8000-000000000001' AND action='session_started'`).Scan(&sessionNulls); err != nil || !sessionNulls {
		t.Fatalf("session context not null: %v %v", sessionNulls, err)
	}
	changedStart := strings.Replace(sessionStart, `"id":"a0000000-0000-4000-8000-000000000001"`, `"id":"a0000000-0000-4000-8000-000000000002"`, 1)
	if response = ingest(host.String(), changedStart); !strings.Contains(response.Body.String(), `"rejected"`) {
		t.Fatal("another ID claimed the same session start")
	}
	if response = ingest(attendee.String(), sessionStart); response.Code != 409 {
		t.Fatal("session start changed actor")
	}

	t.Run("signup insights", func(t *testing.T) { testSignupInsights(t, pool, host, attendee) })
	t.Run("hosting", func(t *testing.T) { testHostingActivities(t, pool, call, attendee) })
	t.Run("reports", func(t *testing.T) { testActivityReports(t, pool) })

	// A failure to record history rolls back the actual creation and host membership.
	pool.Exec(ctx, `CREATE FUNCTION reject_tracking() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test rollback'; END $$; CREATE TRIGGER reject_tracking BEFORE INSERT ON activities FOR EACH ROW EXECUTE FUNCTION reject_tracking()`)
	response = call("POST", "/events", strings.Replace(body, "Tracked", "Rollback", 1), "50000000-0000-4000-8000-000000000001")
	if response.Code != 500 {
		t.Fatalf("rollback response: %d", response.Code)
	}
	pool.QueryRow(ctx, "SELECT count(*) FROM events WHERE title='Rollback'").Scan(&count)
	if count != 0 {
		t.Fatal("creation survived activity failure")
	}
}
