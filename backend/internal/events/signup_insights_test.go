package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
)

// Reuse the isolated activity-test database; no fixtures touch application data.
func testSignupInsights(t *testing.T, pool *pgxpool.Pool, host, player pgtype.UUID) {
	ctx := context.Background()
	handler := Handler{Queries: database.New(pool), DemoUserID: host}
	var secondPlayer pgtype.UUID
	secondPlayer.Scan("20000000-0000-4000-8000-000000000003")
	call := func(handler Handler, id string, want int) map[string]json.RawMessage {
		t.Helper()
		request := httptest.NewRequest("GET", "/events/"+id+"/signup-insights", nil)
		request.SetPathValue("id", id)
		response := httptest.NewRecorder()
		handler.SignupInsights(response, request)
		if response.Code != want {
			t.Fatalf("status %d, want %d: %s", response.Code, want, response.Body.String())
		}
		if response.Header().Get("Cache-Control") != "no-store" {
			t.Fatal("private insights are cacheable")
		}
		var summary map[string]json.RawMessage
		if want == 200 {
			if err := json.Unmarshal(response.Body.Bytes(), &summary); err != nil {
				t.Fatal(err)
			}
			if len(summary) != 8 {
				t.Fatalf("unexpected response fields: %s", response.Body.String())
			}
		}
		return summary
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	create := func(capacity int) (string, time.Time) {
		t.Helper()
		var id string
		var createdAt time.Time
		err := pool.QueryRow(ctx, `INSERT INTO events(host_id,place_id,status_id,title,type,starts_at,capacity)
            VALUES ($1,'00000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
                'Signup insights test','football',now()+interval '1 day',$2) RETURNING id::text,created_at`, host, capacity).Scan(&id, &createdAt)
		if err != nil {
			t.Fatal(err)
		}
		exec(`INSERT INTO event_participants(event_id,user_id) VALUES ($1,$2)`, id, host)
		return id, createdAt
	}
	add := func(eventID, action string, actor pgtype.UUID, at time.Time, count, capacity int, changes string) {
		t.Helper()
		details := fmt.Sprintf(`{"snapshot":{"participant_count":%d,"capacity":%d},"changes":%s}`, count, capacity, changes)
		exec(`INSERT INTO activities(action,user_id,trackable_type,trackable_id,occurred_at,details)
            VALUES ($1,$2,'event',$3,$4,$5)`, action, actor, eventID, at, details)
	}
	assert := func(summary map[string]json.RawMessage, key, want string) {
		t.Helper()
		if string(summary[key]) != want {
			t.Fatalf("%s=%s, want %s", key, summary[key], want)
		}
	}

	eventID, createdAt := create(3)
	add(eventID, "event_created", host, createdAt, 1, 3, `{}`)
	empty := call(handler, eventID, 200)
	for _, key := range []string{"first_signup_at", "first_signup_seconds", "first_full_at", "first_full_seconds", "first_full_reason"} {
		assert(empty, key, "null")
	}
	assert(empty, "unique_players_joined", "0")
	assert(empty, "history_complete", "true")
	call(handler, "bad-id", 400)
	call(Handler{}, eventID, 503)
	call(Handler{Queries: database.New(pool), DemoUserID: player}, eventID, 403)
	call(handler, "90000000-0000-4000-8000-000000000099", 404)

	add(eventID, "participation_joined", player, createdAt.Add(12*time.Minute), 2, 3, `{}`)
	add(eventID, "participation_left", player, createdAt.Add(13*time.Minute), 1, 3, `{}`)
	add(eventID, "participation_joined", player, createdAt.Add(14*time.Minute), 2, 3, `{}`)
	add(eventID, "participation_joined", secondPlayer, createdAt.Add(20*time.Minute), 3, 3, `{}`)
	add(eventID, "event_edited", host, createdAt.Add(21*time.Minute), 3, 4, `{"capacity":{"before":3,"after":4}}`)
	add(eventID, "event_edited", host, createdAt.Add(22*time.Minute), 3, 3, `{"capacity":{"before":4,"after":3}}`)
	add(eventID, "participation_left", player, createdAt.Add(23*time.Minute), 2, 3, `{}`)
	add(eventID, "participation_joined", player, createdAt.Add(24*time.Minute), 3, 3, `{}`)
	// Neither a view of a full event nor unrelated event history is a signup milestone.
	add(eventID, "event_viewed", player, createdAt.Add(time.Minute), 3, 3, `{}`)
	otherID, otherAt := create(2)
	add(otherID, "participation_joined", secondPlayer, otherAt, 2, 2, `{}`)
	summary := call(handler, eventID, 200)
	assert(summary, "unique_players_joined", "2")
	assert(summary, "unique_players_left", "1")
	assert(summary, "first_signup_seconds", "720")
	assert(summary, "first_full_seconds", "1200")
	assert(summary, "first_full_reason", `"signup"`)
	var signupAt time.Time
	if err := json.Unmarshal(summary["first_signup_at"], &signupAt); err != nil || !signupAt.Equal(createdAt.Add(12*time.Minute)) {
		t.Fatalf("signup timestamp: %s %v", summary["first_signup_at"], err)
	}

	reducedID, reducedAt := create(4)
	add(reducedID, "event_created", host, reducedAt, 1, 4, `{}`)
	add(reducedID, "event_edited", host, reducedAt.Add(time.Minute), 1, 1, `{"capacity":{"before":4,"after":1}}`)
	reduced := call(handler, reducedID, 200)
	assert(reduced, "first_full_reason", `"capacity_reduction"`)
	assert(reduced, "first_full_seconds", "60")
	assert(reduced, "unique_players_joined", "0")

	singleID, singleAt := create(1)
	add(singleID, "event_created", host, singleAt, 1, 1, `{}`)
	initial := call(handler, singleID, 200)
	assert(initial, "first_full_reason", `"initial_capacity"`)
	assert(initial, "first_full_seconds", "0")

	legacyID, _ := create(4)
	exec(`INSERT INTO event_participants(event_id,user_id) VALUES ($1,$2)`, legacyID, player)
	legacy := call(handler, legacyID, 200)
	assert(legacy, "history_complete", "false")
	assert(legacy, "unique_players_joined", "1")
	if string(legacy["first_signup_at"]) == "null" {
		t.Fatal("legacy membership signup missing")
	}
	assert(legacy, "first_full_at", "null")
	// An older signup can be known only through a later leave.
	exec(`DELETE FROM event_participants WHERE event_id=$1 AND user_id=$2`, legacyID, player)
	add(legacyID, "participation_left", player, time.Now(), 1, 4, `{}`)
	legacy = call(handler, legacyID, 200)
	assert(legacy, "unique_players_joined", "1")
	assert(legacy, "unique_players_left", "1")
	assert(legacy, "first_signup_at", "null")
	// Cancellation/elapsed status does not erase historical insights.
	exec(`UPDATE events SET status_id='10000000-0000-4000-8000-000000000002' WHERE id=$1`, eventID)
	assert(call(handler, eventID, 200), "first_full_seconds", "1200")
	var eventUUID pgtype.UUID
	eventUUID.Scan(eventID)
	shared, err := database.New(pool).GetEvent(ctx, database.GetEventParams{ID: eventUUID, ViewerID: player})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(shared), "unique_players_joined") || strings.Contains(string(shared), "first_full") {
		t.Fatal("host insights leaked into shared event payload")
	}
}
