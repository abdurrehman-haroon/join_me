package users

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
)

func TestInvalidEventGoals(t *testing.T) {
	for _, body := range []string{
		`null`, `{}`, `{`, `{"event_goal_target":2}`, `{"event_goal_period":"weekly"}`,
		`{"event_goal_target":0,"event_goal_period":"weekly"}`, `{"event_goal_target":-1,"event_goal_period":"weekly"}`,
		`{"event_goal_target":2.5,"event_goal_period":"weekly"}`, `{"event_goal_target":2147483648,"event_goal_period":"weekly"}`,
		`{"event_goal_target":"2","event_goal_period":"weekly"}`, `{"event_goal_target":2,"event_goal_period":"daily"}`,
		`{"event_goal_target":2,"event_goal_period":null}`, `{"event_goal_target":null,"event_goal_period":"weekly"}`,
		`{"event_goal_target":2,"event_goal_period":"weekly","user_id":"other"}`,
		`{"event_goal_target":2,"event_goal_period":"weekly"} {}`,
	} {
		response := httptest.NewRecorder()
		Handler{}.EventGoal(response, httptest.NewRequest("PUT", "/me/event-goal", strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("%s: %d %s", body, response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	Handler{}.EventGoal(response, httptest.NewRequest("PUT", "/me/event-goal", strings.NewReader(`{"event_goal_target":null,"event_goal_period":null}`)))
	if response.Code != 503 {
		t.Fatalf("unconfigured identity: %d", response.Code)
	}
}

func testEventGoalProgress(t *testing.T, pool *pgxpool.Pool, actor pgtype.UUID) {
	ctx := context.Background()
	handler := Handler{Queries: database.New(pool), DemoUserID: actor}
	save := func(body string) {
		t.Helper()
		response := httptest.NewRecorder()
		handler.EventGoal(response, httptest.NewRequest("PUT", "/me/event-goal", strings.NewReader(body)))
		if response.Code != 200 {
			t.Fatalf("save: %d %s", response.Code, response.Body.String())
		}
		var actual, want map[string]any
		if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil {
			t.Fatal(err)
		}
		json.Unmarshal([]byte(body), &want)
		if actual["event_goal_target"] != want["event_goal_target"] || actual["event_goal_period"] != want["event_goal_period"] || len(actual) != 2 {
			t.Fatalf("goal response: %s", response.Body.String())
		}
	}
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	var before, after database.User
	before, err := database.New(pool).GetUser(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	save(`{"event_goal_target":3,"event_goal_period":"weekly"}`)
	save(`{"event_goal_target":3,"event_goal_period":"weekly"}`)
	after, err = database.New(pool).GetUser(ctx, actor)
	if err != nil {
		t.Fatal(err)
	}
	if after.DisplayName != before.DisplayName || !after.CreatedAt.Time.Equal(before.CreatedAt.Time) || !after.UpdatedAt.Time.After(before.UpdatedAt.Time) {
		t.Fatal("goal update changed identity/name/creation or failed to refresh updated_at")
	}
	var otherTarget pgtype.Int4
	if err := pool.QueryRow(ctx, `SELECT event_goal_target FROM users WHERE id='20000000-0000-4000-8000-000000000002'`).Scan(&otherTarget); err != nil || otherTarget.Valid {
		t.Fatalf("another user's goal changed: %v", err)
	}
	for _, sql := range []string{
		`UPDATE users SET event_goal_target=0`,
		`UPDATE users SET event_goal_target=NULL WHERE event_goal_period IS NOT NULL`,
		`UPDATE users SET event_goal_period='daily'`,
	} {
		if _, err := pool.Exec(ctx, sql); err == nil {
			t.Fatalf("database accepted %s", sql)
		}
	}

	// March includes a DST change in New York. Local calendar boundaries must
	// be converted individually rather than adding fixed 24-hour durations.
	exec(`INSERT INTO events(id,host_id,place_id,status_id,title,type,starts_at,capacity)
        SELECT ('40000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
            CASE WHEN n=8 THEN $1::uuid ELSE '20000000-0000-4000-8000-000000000002'::uuid END,
            '00000000-0000-4000-8000-000000000100'::uuid,
            CASE WHEN n=7 THEN '10000000-0000-4000-8000-000000000002'::uuid
                WHEN n=11 THEN '10000000-0000-4000-8000-000000000003'::uuid ELSE '10000000-0000-4000-8000-000000000001'::uuid END,
            'Goal boundary test',CASE WHEN n%2=0 THEN 'football' ELSE 'cricket' END,
            CASE n WHEN 1 THEN '2026-03-09T03:59:59Z'::timestamptz
                WHEN 2 THEN '2026-03-09T04:00:00Z'::timestamptz
                WHEN 3 THEN '2026-03-16T03:59:59Z'::timestamptz
                WHEN 4 THEN '2026-03-16T04:00:00Z'::timestamptz
                WHEN 5 THEN '2026-03-01T04:59:59Z'::timestamptz
                WHEN 6 THEN '2026-04-01T04:00:00Z'::timestamptz
                ELSE '2026-03-10T12:00:00Z'::timestamptz END,10
        FROM generate_series(1,11) n`, actor)
	exec(`INSERT INTO event_participants(event_id,user_id)
        SELECT id,$1 FROM events WHERE id::text LIKE '40000000-%' AND id<>'40000000-0000-4000-8000-000000000009'
            AND id<>'40000000-0000-4000-8000-000000000010'`, actor)
	exec(`INSERT INTO event_participants(event_id,user_id) VALUES ('40000000-0000-4000-8000-000000000010','20000000-0000-4000-8000-000000000002')`)
	read := func() map[string]json.RawMessage {
		t.Helper()
		until := time.Date(2026, 3, 11, 12, 0, 0, 0, time.UTC)
		raw, err := database.New(pool).GetUserActivity(ctx, database.GetUserActivityParams{
			UserID: actor, Timezone: "America/New_York", Since: pgtype.Timestamptz{Time: until.AddDate(-1, 0, 0), Valid: true}, Until: pgtype.Timestamptz{Time: until, Valid: true},
		})
		if err != nil {
			t.Fatal(err)
		}
		var response struct{ Participation map[string]json.RawMessage }
		if err := json.Unmarshal(raw, &response); err != nil {
			t.Fatal(err)
		}
		return response.Participation
	}
	assert := func(progress map[string]json.RawMessage, key, want string) {
		t.Helper()
		if string(progress[key]) != want {
			t.Fatalf("%s=%s, want %s", key, progress[key], want)
		}
	}
	weekly := read()
	for key, want := range map[string]string{"event_goal_target": "3", "event_goal_period": `"weekly"`, "goal_progress": "3", "month_joined": "5", "previous_month_joined": "1", "month_sports": "2", "month_grounds": "1", "month_hosted": "1", "eligible_joined": "9"} {
		assert(weekly, key, want)
	}
	for key, want := range map[string]time.Time{
		"goal_starts_at":  time.Date(2026, 3, 9, 4, 0, 0, 0, time.UTC),
		"goal_ends_at":    time.Date(2026, 3, 16, 4, 0, 0, 0, time.UTC),
		"month_starts_at": time.Date(2026, 3, 1, 5, 0, 0, 0, time.UTC),
		"month_ends_at":   time.Date(2026, 4, 1, 4, 0, 0, 0, time.UTC),
	} {
		var actual time.Time
		if err := json.Unmarshal(weekly[key], &actual); err != nil || !actual.Equal(want) {
			t.Fatalf("%s boundary: %s %v", key, weekly[key], err)
		}
	}
	// Leaving removes eligibility; rejoining restores it without adding a count.
	exec(`DELETE FROM event_participants WHERE event_id='40000000-0000-4000-8000-000000000002' AND user_id=$1`, actor)
	assert(read(), "goal_progress", "2")
	exec(`INSERT INTO event_participants(event_id,user_id) VALUES ('40000000-0000-4000-8000-000000000002',$1) ON CONFLICT DO NOTHING`, actor)
	assert(read(), "goal_progress", "3")
	exec(`UPDATE events SET status_id='10000000-0000-4000-8000-000000000002' WHERE id='40000000-0000-4000-8000-000000000003'`)
	assert(read(), "goal_progress", "2")
	assert(read(), "eligible_joined", "8")
	// Moving kickoff across a period boundary changes scheduled-date progress.
	exec(`UPDATE events SET starts_at='2026-03-16T04:00:00Z' WHERE id='40000000-0000-4000-8000-000000000002'`)
	assert(read(), "goal_progress", "1")
	save(`{"event_goal_target":8,"event_goal_period":"monthly"}`)
	monthly := read()
	assert(monthly, "goal_progress", "4")
	assert(monthly, "event_goal_period", `"monthly"`)
	save(`{"event_goal_target":null,"event_goal_period":null}`)
	off := read()
	for _, key := range []string{"event_goal_target", "event_goal_period", "goal_starts_at", "goal_ends_at"} {
		assert(off, key, "null")
	}
	assert(off, "goal_progress", "0")
}
