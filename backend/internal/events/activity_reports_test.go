package events

import (
	"context"
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Exercise the actual report files against known history, including attribution traps.
// The transaction and isolated test schema keep fixtures away from application data.
func testActivityReports(t *testing.T, pool *pgxpool.Pool) {
	ctx := context.Background()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, "DELETE FROM activities"); err != nil {
		t.Fatal(err)
	}
	const event = "30000000-0000-4000-8000-000000000001"
	const otherEvent = "30000000-0000-4000-8000-000000000002"
	const place = "00000000-0000-4000-8000-000000000003"
	const actor = "20000000-0000-4000-8000-000000000001"
	const otherActor = "20000000-0000-4000-8000-000000000002"
	row := 0
	interaction := func(number int) string { return fmt.Sprintf("90000000-0000-4000-8000-%012d", number) }
	add := func(action, targetType, targetID, source, actorID string, visit, minute int, details string) string {
		t.Helper()
		row++
		activityID := fmt.Sprintf("80000000-0000-4000-8000-%012d", row)
		_, err := tx.Exec(ctx, `INSERT INTO activities (id,action,user_id,session_id,interaction_id,trackable_type,trackable_id,source,occurred_at,details)
   VALUES ($1,$2,$3,'90000000-0000-4000-8000-999999999999',$4,NULLIF($5,'')::activity_trackable_type,NULLIF($6,'')::uuid,$7,'2020-01-01T00:00:00Z'::timestamptz + $8 * interval '1 minute',$9)`,
			activityID, action, actorID, interaction(visit), targetType, targetID, source, minute, details)
		if err != nil {
			t.Fatal(err)
		}
		return activityID
	}
	add("event_creation_started", "place", place, "event_form", actor, 1, 0, `{"elapsed_ms":0,"active_ms":0}`)
	add("event_creation_submitted", "place", place, "event_form", actor, 1, 1, `{"elapsed_ms":90000,"active_ms":50000,"attempt_number":1}`)
	add("event_created", "event", event, "event_form", actor, 1, 2, `{}`)
	add("event_creation_started", "place", place, "event_form", actor, 2, 0, `{"elapsed_ms":0,"active_ms":0}`)
	add("place_viewed", "place", place, "map", actor, 5, 0, `{"sport":"football"}`)
	for _, visit := range []int{3, 6, 7, 8} {
		actorID, target := actor, event
		if visit == 6 {
			actorID = otherActor
		}
		if visit == 7 {
			target = otherEvent
		}
		add("event_viewed", "event", target, "place_details", actorID, visit, 1, fmt.Sprintf(`{"viewer_role":"visitor","referrer_interaction_id":%q}`, interaction(5)))
	}
	add("event_viewed", "event", event, "place_details", actor, 4, 1, fmt.Sprintf(`{"viewer_role":"host","referrer_interaction_id":%q}`, interaction(5)))
	add("join_attempted", "event", event, "event_details", actor, 3, 2, `{"elapsed_ms":30000,"active_ms":20000,"attempt_number":1}`)
	add("participation_joined", "event", event, "event_details", actor, 3, 3, `{"snapshot":{"participant_count":1,"capacity":3}}`)
	// Matching interaction alone cannot attribute another actor's join.
	add("participation_joined", "event", event, "event_details", otherActor, 8, 3, `{"snapshot":{"participant_count":1,"capacity":3}}`)
	firstEditID := add("event_edited", "event", event, "event_form", actor, 10, 10, `{"changes":{"title":{"changed":true},"capacity":{"before":4,"after":2},"starts_at":{"before":"2020-01-01T02:00:00Z","after":"2020-01-01T01:00:00Z"}},"snapshot":{"participant_count":2,"capacity":2}}`)
	add("event_edited", "event", event, "event_form", actor, 11, 11, `{"changes":{"title":{"changed":true}},"snapshot":{"participant_count":2,"capacity":2}}`)
	add("participation_joined", "event", event, "event_details", actor, 12, 20, `{"snapshot":{"participant_count":2,"capacity":2}}`)
	add("participation_left", "event", event, "event_details", actor, 13, 30, `{"snapshot":{"participant_count":1,"capacity":2}}`)
	secondEditID := add("event_edited", "event", event, "event_form", actor, 14, 40, `{"changes":{"starts_at":{"before":"2020-01-01T02:00:00Z","after":"2020-01-01T01:00:00Z"}},"snapshot":{"participant_count":1,"capacity":2}}`)
	add("participation_joined", "event", event, "event_details", actor, 15, 45, `{"snapshot":{"participant_count":1,"capacity":2}}`)
	add("event_cancelled", "event", event, "event_details", actor, 16, 50, `{"previous_status":"scheduled","snapshot":{"participant_count":1,"capacity":2,"starts_at":"2020-01-01T01:00:00Z","status":"cancelled"}}`)

	add("sport_filter_selected", "", "", "map", actor, 20, 0, `{"sport":"football"}`)
	add("empty_results_viewed", "", "", "map", actor, 21, 0, `{"sport":"football","empty_kind":"no_events"}`)
	add("empty_results_viewed", "", "", "map", actor, 22, 0, `{"sport":"football","empty_kind":"no_places"}`)
	add("empty_results_viewed", "place", place, "place_details", actor, 5, 1, `{"sport":"football","empty_kind":"no_events","elapsed_ms":1000,"active_ms":1000}`)

	run := func(name string) []*pgconn.Result {
		t.Helper()
		sql, err := os.ReadFile("../../reports/" + name + ".sql")
		if err != nil {
			t.Fatal(err)
		}
		query := strings.NewReplacer(":'from'", "'2020-01-01T00:00:00Z'", ":'until'", "'2020-01-02T00:00:00Z'").Replace(string(sql))
		results, err := tx.Conn().PgConn().Exec(ctx, query).ReadAll()
		if err != nil {
			t.Fatal(err)
		}
		return results
	}
	expect := func(results []*pgconn.Result, matchColumn, matchValue string, wanted map[string]string) {
		t.Helper()
		for _, result := range results {
			for _, values := range result.Rows {
				columns := make(map[string]string)
				for i, field := range result.FieldDescriptions {
					columns[string(field.Name)] = string(values[i])
				}
				if columns[matchColumn] != matchValue {
					continue
				}
				for key, value := range wanted {
					if columns[key] != value {
						t.Fatalf("%s=%s: %s got %q want %q", matchColumn, matchValue, key, columns[key], value)
					}
				}
				return
			}
		}
		t.Fatalf("report row missing: %s=%s", matchColumn, matchValue)
	}
	previous := run("activities")
	expect(previous, "flow", "creation", map[string]string{"started": "2", "confirmed": "1", "no_confirmed_completion": "1"})
	expect(previous, "flow", "view_to_join", map[string]string{"started": "4", "confirmed": "1"})
	expect(previous, "action", "event_creation_submitted", map[string]string{"elapsed_p50_ms": "90000", "active_p50_ms": "50000"})
	discovery := run("discovery")
	expect(discovery, "selected_filter", "football", map[string]string{"place_openings": "1", "filter_changes": "1", "map_no_events": "1", "map_no_places": "1", "place_no_events": "1"})
	expect(discovery, "place_id", place, map[string]string{"place_visits": "1", "visitor_event_views": "2", "views_with_confirmed_join": "1"})
	hosting := run("hosting")
	expect(hosting, "edits", "3", map[string]string{"events_edited": "1", "title_edits": "2", "capacity_edits": "1", "reschedules": "2"})
	expect(hosting, "full_cause", "join", map[string]string{"transitions_to_full": "1"})
	expect(hosting, "full_cause", "capacity_reduction", map[string]string{"transitions_to_full": "1"})
	expect(hosting, "previous_status", "scheduled", map[string]string{"cancellations": "1", "within_one_hour": "1", "lead_p50_seconds": "600", "affected_memberships": "1"})
	expect(hosting, "edit_activity_id", firstEditID, map[string]string{"joins_after": "1", "leaves_after": "1"})
	expect(hosting, "edit_activity_id", secondEditID, map[string]string{"joins_after": "1", "leaves_after": "0"})
	// Separate chat fixtures keep earlier report assertions independent.
	// Four existing join memberships: actor joined at 3, 20 and 45; otherActor at 3.
	add("chat_opened", "event", event, "event_details", actor, 30, 21, `{"elapsed_ms":0,"active_ms":0}`)
	add("message_sent", "event", event, "event_chat", actor, 30, 22, `{}`)
	add("chat_opened", "event", event, "event_details", actor, 31, 46, `{"elapsed_ms":0,"active_ms":0}`)
	// Same interaction, wrong actor cannot complete the visit.
	add("message_sent", "event", event, "event_chat", otherActor, 31, 47, `{}`)
	// Nor can the wrong event or a message outside 24-hour follow-up.
	add("message_sent", "event", otherEvent, "event_chat", actor, 31, 48, `{}`)
	add("message_sent", "event", event, "event_chat", actor, 31, 1500, `{}`)
	wrongSession := add("message_sent", "event", event, "event_chat", actor, 31, 49, `{}`)
	if _, err := tx.Exec(ctx, `UPDATE activities SET session_id='90000000-0000-4000-8000-111111111111' WHERE id=$1`, wrongSession); err != nil {
		t.Fatal(err)
	}
	// A same-actor open/message after leaving must not complete the earlier membership.
	add("chat_opened", "event", event, "event_details", actor, 32, 31, `{"elapsed_ms":0,"active_ms":0}`)
	add("message_sent", "event", event, "event_chat", actor, 32, 32, `{}`)
	chat := run("chat")
	expect(chat, "joined_memberships", "4", map[string]string{"memberships_opening_chat": "2", "memberships_sending_message": "3", "memberships_opening_and_sending": "2", "pending_followups": "0"})
	expect(chat, "chat_visits", "3", map[string]string{"visits_with_message": "2", "mature_visits": "3", "mature_message_conversion": "0.6667"})
	expect(chat, "messages_sent", "5", map[string]string{"messages_without_observed_visit": "3"})

	if _, err := tx.Exec(ctx, `INSERT INTO activities(id,action,user_id,session_id,occurred_at,details) VALUES
		('90000000-0000-4000-8000-999999999999','session_started',$1,'90000000-0000-4000-8000-999999999999','2020-01-01T00:00:00Z','{}'),
		('90000000-0000-4000-8000-222222222222','session_started',$2,'90000000-0000-4000-8000-222222222222','2020-01-01T00:10:00Z','{}')`, actor, otherActor); err != nil {
		t.Fatal(err)
	}
	sessions := run("sessions")
	expect(sessions, "sessions_started", "2", map[string]string{"recorded_actor_ids": "2"})
	expect(sessions, "session_id", "90000000-0000-4000-8000-999999999999", map[string]string{"events_created": "1", "joins": "3", "chat_visits": "3"})
	expect(sessions, "session_id", "90000000-0000-4000-8000-222222222222", map[string]string{"observed_activity_rows": "0", "events_created": "0", "joins": "0", "chat_visits": "0"})

}
