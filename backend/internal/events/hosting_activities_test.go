package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
)

func testHostingActivities(t *testing.T, pool *pgxpool.Pool, call func(string, string, string, string) *httptest.ResponseRecorder, attendee pgtype.UUID) {
	ctx := context.Background()
	start := time.Now().Add(2 * time.Hour).UTC().Truncate(time.Second)
	body := fmt.Sprintf(`{"place_id":"00000000-0000-4000-8000-000000000003","title":"Private original title","type":"football","starts_at":%q,"capacity":4}`, start.Format(time.RFC3339))
	response := call("POST", "/events", body, "")
	if response.Code != 201 {
		t.Fatal(response.Body.String())
	}
	var created struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	path := "/events/" + created.ID
	edit := fmt.Sprintf(`{"title":"Private revised title","starts_at":%q,"capacity":1}`, start.Add(time.Hour).Format(time.RFC3339))
	// Concurrent identical updates serialize under the event lock and emit one edit.
	var wait sync.WaitGroup
	for range 3 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if reply := call("PATCH", path, edit, ""); reply.Code != 204 {
				t.Errorf("edit: %d %s", reply.Code, reply.Body.String())
			}
		}()
	}
	wait.Wait()
	var count int
	var details []byte
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM activities WHERE action='event_edited' AND trackable_id=$1", created.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("edits: %d %v", count, err)
	}
	if err := pool.QueryRow(ctx, "SELECT details FROM activities WHERE action='event_edited' AND trackable_id=$1 AND source='event_form' AND interaction_step IS NULL AND user_id <> $2", created.ID, attendee).Scan(&details); err != nil {
		t.Fatal(err)
	}
	var history struct {
		Changes struct {
			Title struct {
				Changed bool `json:"changed"`
			} `json:"title"`
			Capacity struct{ Before, After int }       `json:"capacity"`
			StartsAt struct{ Before, After time.Time } `json:"starts_at"`
		} `json:"changes"`
		Snapshot struct {
			Capacity         int
			ParticipantCount int `json:"participant_count"`
			Status           string
			StartsAt         time.Time `json:"starts_at"`
		} `json:"snapshot"`
	}
	if err := json.Unmarshal(details, &history); err != nil {
		t.Fatal(err)
	}
	if !history.Changes.Title.Changed || history.Changes.Capacity.Before != 4 || history.Changes.Capacity.After != 1 || !history.Changes.StartsAt.Before.Equal(start) || !history.Changes.StartsAt.After.Equal(start.Add(time.Hour)) || history.Snapshot.Capacity != 1 || history.Snapshot.ParticipantCount != 1 || history.Snapshot.Status != "scheduled" {
		t.Fatalf("incorrect history: %s", details)
	}
	if strings.Contains(string(details), "Private") {
		t.Fatal("title content leaked into history")
	}
	// A title-only edit has no invented capacity or rescheduling changes.
	titleOnly := strings.Replace(edit, "Private revised title", "Third private title", 1)
	if reply := call("PATCH", path, titleOnly, ""); reply.Code != 204 {
		t.Fatal(reply.Body.String())
	}
	if err := pool.QueryRow(ctx, "SELECT details FROM activities WHERE action='event_edited' AND trackable_id=$1 ORDER BY occurred_at DESC LIMIT 1", created.ID).Scan(&details); err != nil {
		t.Fatal(err)
	}
	var titleHistory struct {
		Changes map[string]any `json:"changes"`
	}
	json.Unmarshal(details, &titleHistory)
	if len(titleHistory.Changes) != 1 || titleHistory.Changes["title"] == nil {
		t.Fatalf("unchanged fields recorded: %s", details)
	}

	// Unauthorized, invalid and capacity-conflicting edits add no history.
	guest := Handler{Queries: database.New(pool), Pool: pool, DemoUserID: attendee}
	request := httptest.NewRequest("PATCH", path, strings.NewReader(edit))
	request.SetPathValue("id", created.ID)
	denied := httptest.NewRecorder()
	guest.UpdateEvent(denied, request)
	if denied.Code != 403 {
		t.Fatalf("non-host edit: %d", denied.Code)
	}
	if reply := call("PATCH", path, strings.Replace(edit, `"capacity":1`, `"capacity":0`, 1), ""); reply.Code != 400 {
		t.Fatalf("invalid edit: %d", reply.Code)
	}
	// Raising capacity then joining makes reducing below membership invalid.
	raised := strings.Replace(titleOnly, `"capacity":1`, `"capacity":3`, 1)
	if reply := call("PATCH", path, raised, ""); reply.Code != 204 {
		t.Fatal(reply.Body.String())
	}
	if reply := call("PUT", path+"/participation", "", ""); reply.Code != 204 {
		t.Fatal(reply.Body.String())
	}
	if reply := call("PATCH", path, titleOnly, ""); reply.Code != 409 {
		t.Fatalf("capacity conflict: %d", reply.Code)
	}

	// History and realtime publication must roll back together with each mutation.
	var beforeEvent, afterEvent string
	if err := pool.QueryRow(ctx, "SELECT row_to_json(events)::text FROM events WHERE id=$1", created.ID).Scan(&beforeEvent); err != nil {
		t.Fatal(err)
	}
	var beforeOutbox, afterOutbox int
	pool.QueryRow(ctx, "SELECT count(*) FROM realtime_outbox").Scan(&beforeOutbox)
	_, err := pool.Exec(ctx, `CREATE FUNCTION reject_host_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('event_edited','event_cancelled') THEN RAISE EXCEPTION 'test rollback'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_host_history BEFORE INSERT ON activities FOR EACH ROW EXECUTE FUNCTION reject_host_history()`)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Exec(ctx, "DROP TRIGGER IF EXISTS reject_host_history ON activities; DROP FUNCTION IF EXISTS reject_host_history()")
	})
	if reply := call("PATCH", path, strings.Replace(raised, `"capacity":3`, `"capacity":5`, 1), ""); reply.Code != 500 {
		t.Fatalf("edit rollback: %d", reply.Code)
	}
	if reply := call("PUT", path+"/cancellation", "", ""); reply.Code != 500 {
		t.Fatalf("cancel rollback: %d", reply.Code)
	}
	pool.QueryRow(ctx, "SELECT row_to_json(events)::text FROM events WHERE id=$1", created.ID).Scan(&afterEvent)
	pool.QueryRow(ctx, "SELECT count(*) FROM realtime_outbox").Scan(&afterOutbox)
	if beforeEvent != afterEvent || beforeOutbox != afterOutbox {
		t.Fatal("mutation or publication survived history failure")
	}
	if _, err := pool.Exec(ctx, "DROP TRIGGER reject_host_history ON activities; DROP FUNCTION reject_host_history()"); err != nil {
		t.Fatal(err)
	}
	request = httptest.NewRequest("PUT", path+"/cancellation", nil)
	request.SetPathValue("id", created.ID)
	denied = httptest.NewRecorder()
	guest.CancelEvent(denied, request)
	if denied.Code != 403 {
		t.Fatalf("non-host cancellation: %d", denied.Code)
	}
	for range 3 {
		wait.Add(1)
		go func() {
			defer wait.Done()
			if reply := call("PUT", path+"/cancellation", "", ""); reply.Code != 204 {
				t.Errorf("cancel: %d %s", reply.Code, reply.Body.String())
			}
		}()
	}
	wait.Wait()
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM activities WHERE action='event_cancelled' AND trackable_id=$1", created.ID).Scan(&count); err != nil || count != 1 {
		t.Fatalf("cancellations: %d %v", count, err)
	}
	if err := pool.QueryRow(ctx, "SELECT details FROM activities WHERE action='event_cancelled' AND trackable_id=$1 AND source='event_details'", created.ID).Scan(&details); err != nil {
		t.Fatal(err)
	}
	var cancelled struct {
		PreviousStatus string `json:"previous_status"`
		Snapshot       struct {
			Status           string
			Capacity         int
			ParticipantCount int       `json:"participant_count"`
			StartsAt         time.Time `json:"starts_at"`
		} `json:"snapshot"`
	}
	if err := json.Unmarshal(details, &cancelled); err != nil {
		t.Fatal(err)
	}
	if cancelled.PreviousStatus != "scheduled" || cancelled.Snapshot.Status != "cancelled" || cancelled.Snapshot.Capacity != 3 || cancelled.Snapshot.ParticipantCount != 2 || !cancelled.Snapshot.StartsAt.Equal(start.Add(time.Hour)) {
		t.Fatalf("cancellation snapshot: %s", details)
	}
	if reply := call("PATCH", path, raised, ""); reply.Code != 409 {
		t.Fatalf("cancelled edit: %d", reply.Code)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM activities WHERE action='event_edited' AND trackable_id=$1", created.ID).Scan(&count); err != nil || count != 3 {
		t.Fatalf("failed/no-op edits added history: %d %v", count, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM event_participants WHERE event_id=$1", created.ID).Scan(&count); err != nil || count != 2 {
		t.Fatalf("cancel lost roster: %d %v", count, err)
	}
}
