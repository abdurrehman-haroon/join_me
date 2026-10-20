package users

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
	"joinme/backend/migrations"
)

func TestActivityParameters(t *testing.T) {
	for _, query := range []string{"period=week", "timezone=unknown/zone", "timezone=Local", "offset=-1", "offset=2147483628", "offset=no", "user_id=other", "period=all&period=month"} {
		response := httptest.NewRecorder()
		Handler{}.Activity(response, httptest.NewRequest("GET", "/me/activity?"+query, nil))
		if response.Code != 400 {
			t.Fatalf("%s: got %d", query, response.Code)
		}
	}
	response := httptest.NewRecorder()
	Handler{}.Activity(response, httptest.NewRequest("GET", "/me/activity", nil))
	if response.Code != 503 {
		t.Fatalf("unconfigured identity: %d", response.Code)
	}
}

func TestPersonalActivity(t *testing.T) {
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
	schema := fmt.Sprintf("user_activity_test_%d", time.Now().UnixNano())
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
	var actor pgtype.UUID
	actor.Scan("20000000-0000-4000-8000-000000000001")
	handler := Handler{Queries: database.New(pool), DemoUserID: actor}
	call := func(query string, want int) map[string]json.RawMessage {
		t.Helper()
		response := httptest.NewRecorder()
		handler.Activity(response, httptest.NewRequest("GET", "/me/activity?"+query, nil))
		if response.Code != want {
			t.Fatalf("%s: %d %s", query, response.Code, response.Body.String())
		}
		var result map[string]json.RawMessage
		if want == 200 {
			if response.Header().Get("Cache-Control") != "no-store" {
				t.Fatal("personal response is cacheable")
			}
			if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
				t.Fatal(err)
			}
		}
		return result
	}
	call("period=all", 503)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`INSERT INTO users(id,display_name) VALUES ($1,'Demo'),('20000000-0000-4000-8000-000000000002','Other')`, actor)
	empty := call("period=all", 200)
	if string(empty["joined"]) != "0" || string(empty["history"]) != "[]" || string(empty["sports"]) != "[]" || string(empty["grounds"]) != "[]" {
		t.Fatalf("bad empty response: %s", empty)
	}
	exec(`INSERT INTO events(id,host_id,place_id,status_id,title,type,starts_at,capacity)
        SELECT ('30000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
            CASE WHEN n=1 THEN $1::uuid ELSE '20000000-0000-4000-8000-000000000002'::uuid END,
            '00000000-0000-4000-8000-000000000003',
            CASE WHEN n IN (1,3) THEN '10000000-0000-4000-8000-000000000002'::uuid ELSE '10000000-0000-4000-8000-000000000001'::uuid END,
            'Event '||n, CASE WHEN n=3 THEN 'cricket'::event_type ELSE 'football'::event_type END,
            now()+interval '1 day',10 FROM generate_series(1,5) n`, actor)
	exec(`INSERT INTO event_participants(event_id,user_id) VALUES
        ('30000000-0000-4000-8000-000000000001',$1),
        ('30000000-0000-4000-8000-000000000002',$1),
        ('30000000-0000-4000-8000-000000000004',$1)`, actor)
	exec(`INSERT INTO activities(action,user_id,trackable_type,trackable_id,occurred_at)
        SELECT 'participation_joined', $1, 'event', '30000000-0000-4000-8000-000000000002', now()-n*interval '1 minute'
        FROM generate_series(1,22) n`, actor)
	exec(`INSERT INTO activities(action,user_id,trackable_type,trackable_id,occurred_at) VALUES
        ('participation_joined',$1,'event','30000000-0000-4000-8000-000000000003','2020-01-01T00:00:00Z'),
        ('participation_left',$1,'event','30000000-0000-4000-8000-000000000003','2020-01-02T00:00:00Z'),
        ('event_cancelled',$1,'event','30000000-0000-4000-8000-000000000001',now()),
        ('participation_joined','20000000-0000-4000-8000-000000000002','event','30000000-0000-4000-8000-000000000005',now())`, actor)
	all := call("period=all", 200)
	for key, want := range map[string]string{"joined": "3", "hosted": "1", "left": "1", "cancelled_joined": "1", "cancelled_hosted": "1", "next_offset": "20"} {
		if string(all[key]) != want {
			t.Fatalf("%s=%s, want %s", key, all[key], want)
		}
	}
	var history []struct {
		EventID string `json:"event_id"`
		EntryID string `json:"entry_id"`
		Action  string `json:"action"`
	}
	if err := json.Unmarshal(all["history"], &history); err != nil {
		t.Fatal(err)
	}
	if len(history) != 20 {
		t.Fatalf("page length %d", len(history))
	}
	seen := map[string]bool{}
	for _, entry := range history {
		seen[entry.EntryID+entry.Action] = true
		if entry.EventID == "30000000-0000-4000-8000-000000000005" {
			t.Fatal("other user's history leaked")
		}
	}
	second := call("period=all&offset=20", 200)
	json.Unmarshal(second["history"], &history)
	if len(history) != 7 || string(second["next_offset"]) != "null" {
		t.Fatalf("bad second page: %s", second["history"])
	}
	for _, entry := range history {
		if seen[entry.EntryID+entry.Action] {
			t.Fatal("page repeated an entry")
		}
	}
	month := call("period=month&timezone=Asia%2FKarachi", 200)
	if string(month["joined"]) != "2" || string(month["left"]) != "0" {
		t.Fatalf("month leaked older first join: %s", month)
	}
	var sports []struct {
		Type           string
		Joined, Hosted int
	}
	json.Unmarshal(all["sports"], &sports)
	if len(sports) != 2 || sports[0].Type != "football" || sports[0].Joined != 2 || sports[0].Hosted != 1 || sports[1].Type != "cricket" || sports[1].Joined != 1 {
		t.Fatalf("sports %s", all["sports"])
	}
	var grounds []struct{ Events int }
	json.Unmarshal(all["grounds"], &grounds)
	if len(grounds) != 1 || grounds[0].Events != 4 {
		t.Fatalf("grounds %s", all["grounds"])
	}

	// A join just before Karachi's month boundary belongs to the previous month,
	// even though its current membership and later rejoin are newer.
	now := time.Now().In(time.FixedZone("PKT", 5*60*60))
	boundary := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	exec(`INSERT INTO activities(action,user_id,trackable_type,trackable_id,occurred_at)
        VALUES ('participation_joined',$1,'event','30000000-0000-4000-8000-000000000002',$2)`, actor, boundary.Add(-time.Second))
	month = call("period=month&timezone=Asia%2FKarachi", 200)
	if string(month["joined"]) != "1" {
		t.Fatalf("timezone boundary/rejoin inflated count: %s", month["joined"])
	}
	t.Run("event goal and progress", func(t *testing.T) { testEventGoalProgress(t, pool, actor) })
}
