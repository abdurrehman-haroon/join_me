package activities

import (
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
	"testing"
	"time"
)

func TestClientActivityContract(t *testing.T) {
	var id pgtype.UUID
	id.Scan("30000000-0000-4000-8000-000000000001")
	placeType := database.ActivityTrackableTypePlace
	step := int32(2)
	formSource := database.ActivitySourceEventForm
	eventType := database.ActivityTrackableTypeEvent
	valid := clientActivity{ID: id, Action: database.ActivityActionEventCreationSubmitted, SessionID: id,
		InteractionID: id, InteractionStep: &step, TrackableType: &placeType,
		TrackableID: id, Source: &formSource, OccurredAt: time.Now(),
		Details: json.RawMessage(`{"elapsed_ms":90000,"active_ms":50000,"attempt_number":1}`)}
	if err := valid.validate(time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, details := range []string{
		`null`, `{}`, `{"elapsed_ms":10,"active_ms":11,"attempt_number":1}`,
		`{"elapsed_ms":10.5,"active_ms":1,"attempt_number":1}`,
		`{"elapsed_ms":10,"active_ms":1,"attempt_number":0}`,
		`{"elapsed_ms":10,"active_ms":1,"attempt_number":1,"body":"private text"}`,
		`{"elapsed_ms":10,"active_ms":1,"attempt_number":1,"reason":null}`,
		`{"elapsed_ms":10,"active_ms":1,"attempt_number":1,"snapshot":null}`,
	} {
		activity := valid
		activity.Details = json.RawMessage(details)
		if activity.validate(time.Now()) == nil {
			t.Fatalf("accepted %s", details)
		}
	}
	for _, action := range []database.ActivityAction{database.ActivityActionEventCreated, database.ActivityActionEventEdited, database.ActivityActionEventCancelled} {
		forged := valid
		forged.Action = action
		forged.TrackableType = &eventType
		forged.Source = &formSource
		forged.Details = json.RawMessage(`{"changes":{"title":{"changed":true}},"previous_status":"scheduled","snapshot":{"participant_count":1,"capacity":2,"starts_at":"2026-10-19T12:00:00Z","status":"scheduled"}}`)
		if forged.validate(time.Now()) == nil {
			t.Fatalf("client can forge backend action %s", action)
		}
	}
	withoutSource := valid
	withoutSource.Source = nil
	if withoutSource.validate(time.Now()) == nil {
		t.Fatal("screen activity accepted null source")
	}
	withoutStep := valid
	withoutStep.InteractionStep = nil
	if withoutStep.validate(time.Now()) == nil {
		t.Fatal("screen activity accepted null step")
	}
	old := valid
	old.OccurredAt = time.Now().Add(-8 * 24 * time.Hour)
	if old.validate(time.Now()) == nil {
		t.Fatal("accepted expired row")
	}
	badTarget := valid
	badTarget.TrackableType = &eventType
	if badTarget.validate(time.Now()) == nil {
		t.Fatal("creation targeted an event")
	}
}

func TestDiscoveryActivityContract(t *testing.T) {
	const placeID = "30000000-0000-4000-8000-000000000008"
	const referrerID = "30000000-0000-4000-8000-000000000009"
	cases := []struct {
		name, action, source, targetType, targetID, details string
		step                                                int32
		valid                                               bool
	}{
		{"filter", "sport_filter_selected", "map", "null", "null", `{"sport":"cricket"}`, 1, true},
		{"map has no games", "empty_results_viewed", "map", "null", "null", `{"sport":"all","empty_kind":"no_events"}`, 2, true},
		{"map has no places", "empty_results_viewed", "map", "null", "null", `{"sport":"football","empty_kind":"no_places"}`, 1, true},
		{"place view", "place_viewed", "map", `"place"`, `"` + placeID + `"`, `{"sport":"all","referrer_interaction_id":"` + referrerID + `","elapsed_ms":0,"active_ms":0}`, 1, true},
		{"place empty", "empty_results_viewed", "place_details", `"place"`, `"` + placeID + `"`, `{"sport":"cricket","empty_kind":"no_events","elapsed_ms":9000,"active_ms":8000}`, 2, true},
		{"place overlay", "interaction_paused", "place_details", `"place"`, `"` + placeID + `"`, `{"reason":"screen_hidden","elapsed_ms":9000,"active_ms":8000}`, 3, true},
		{"GPS rejected", "empty_results_viewed", "map", "null", "null", `{"sport":"all","empty_kind":"no_events","bbox":[74,31,75,32]}`, 2, false},
		{"invalid filter", "sport_filter_selected", "map", "null", "null", `{"sport":"tennis"}`, 1, false},
		{"filter has entity", "sport_filter_selected", "map", `"place"`, `"` + placeID + `"`, `{"sport":"all"}`, 1, false},
		{"paired target", "sport_filter_selected", "map", "null", `"` + placeID + `"`, `{"sport":"all"}`, 1, false},
		{"empty enum is not null", "sport_filter_selected", "map", `""`, "null", `{"sport":"all"}`, 1, false},
		{"unknown type", "place_viewed", "map", `"campus"`, `"` + placeID + `"`, `{"sport":"all"}`, 1, false},
		{"no places in place", "empty_results_viewed", "place_details", `"place"`, `"` + placeID + `"`, `{"sport":"all","empty_kind":"no_places","elapsed_ms":1,"active_ms":1}`, 2, false},
		{"map timers rejected", "empty_results_viewed", "map", "null", "null", `{"sport":"all","empty_kind":"no_events","elapsed_ms":0,"active_ms":0}`, 1, false},
		{"place referrer required", "place_viewed", "map", `"place"`, `"` + placeID + `"`, `{"sport":"all","elapsed_ms":0,"active_ms":0}`, 1, false},
		{"place starts zero", "place_viewed", "map", `"place"`, `"` + placeID + `"`, `{"sport":"all","referrer_interaction_id":"` + referrerID + `","elapsed_ms":5,"active_ms":5}`, 1, false},
	}
	for _, example := range cases {
		t.Run(example.name, func(t *testing.T) {
			body := fmt.Sprintf(`{"id":"30000000-0000-4000-8000-000000000001","action":%q,"session_id":"30000000-0000-4000-8000-000000000002","interaction_id":"30000000-0000-4000-8000-000000000003","interaction_step":%d,"trackable_type":%s,"trackable_id":%s,"source":%q,"occurred_at":%q,"details":%s}`,
				example.action, example.step, example.targetType, example.targetID, example.source, time.Now().UTC().Format(time.RFC3339Nano), example.details)
			var activity clientActivity
			if err := json.Unmarshal([]byte(body), &activity); err != nil {
				t.Fatal(err)
			}
			err := activity.validate(time.Now())
			if (err == nil) != example.valid {
				t.Fatalf("valid=%v: %v", example.valid, err)
			}
		})
	}
}

func TestChatActivityContract(t *testing.T) {
	var id pgtype.UUID
	id.Scan("30000000-0000-4000-8000-000000000001")
	eventType := database.ActivityTrackableTypeEvent
	firstStep, secondStep := int32(1), int32(2)
	detailsSource, chatSource := database.ActivitySourceEventDetails, database.ActivitySourceEventChat
	opened := clientActivity{ID: id, SessionID: id, InteractionID: id, InteractionStep: &firstStep,
		Action: database.ActivityActionChatOpened, TrackableType: &eventType, TrackableID: id,
		Source: &detailsSource, OccurredAt: time.Now(), Details: json.RawMessage(`{"elapsed_ms":0,"active_ms":0}`)}
	if err := opened.validate(time.Now()); err != nil {
		t.Fatal(err)
	}
	paused := opened
	paused.Action = database.ActivityActionInteractionPaused
	paused.Source = &chatSource
	paused.InteractionStep = &secondStep
	paused.Details = json.RawMessage(`{"elapsed_ms":10000,"active_ms":5000,"reason":"app_backgrounded"}`)
	if err := paused.validate(time.Now()); err != nil {
		t.Fatal(err)
	}
	for _, change := range []func(*clientActivity){
		func(a *clientActivity) { a.Action = database.ActivityActionMessageSent },
		func(a *clientActivity) { a.Source = &chatSource },
		func(a *clientActivity) { a.InteractionStep = &secondStep },
		func(a *clientActivity) { a.Details = json.RawMessage(`{"elapsed_ms":1,"active_ms":1}`) },
		func(a *clientActivity) {
			a.Details = json.RawMessage(`{"elapsed_ms":0,"active_ms":0,"body":"private"}`)
		},
		func(a *clientActivity) {
			a.Details = json.RawMessage(`{"elapsed_ms":0,"active_ms":0,"attempt_number":1}`)
		},
	} {
		invalid := opened
		change(&invalid)
		if invalid.validate(time.Now()) == nil {
			t.Fatalf("accepted invalid chat activity: %+v", invalid)
		}
	}
}

func TestSessionStartedContract(t *testing.T) {
	var sessionID, otherID pgtype.UUID
	sessionID.Scan("90000000-0000-4000-8000-000000000001")
	otherID.Scan("90000000-0000-4000-8000-000000000002")
	started := clientActivity{ID: sessionID, SessionID: sessionID, Action: database.ActivityActionSessionStarted, OccurredAt: time.Now(), Details: json.RawMessage(`{}`)}
	if err := started.validate(time.Now()); err != nil {
		t.Fatal(err)
	}
	step := int32(1)
	emptySource := database.ActivitySource("")
	mapSource := database.ActivitySourceMap
	placeType := database.ActivityTrackableTypePlace
	for _, change := range []func(*clientActivity){
		func(a *clientActivity) { a.ID = otherID },
		func(a *clientActivity) { a.SessionID = pgtype.UUID{} },
		func(a *clientActivity) { a.InteractionID = otherID },
		func(a *clientActivity) { a.InteractionStep = &step },
		func(a *clientActivity) { a.Source = &emptySource },
		func(a *clientActivity) { a.Source = &mapSource },
		func(a *clientActivity) { a.TrackableType = &placeType; a.TrackableID = otherID },
		func(a *clientActivity) { a.Details = json.RawMessage(`null`) },
		func(a *clientActivity) { a.Details = json.RawMessage(`[]`) },
		func(a *clientActivity) { a.Details = json.RawMessage(`{"elapsed_ms":0}`) },
		func(a *clientActivity) { a.Details = json.RawMessage(`{"platform":"ios"}`) },
	} {
		invalid := started
		change(&invalid)
		if invalid.validate(time.Now()) == nil {
			t.Fatalf("accepted invalid session start: %+v", invalid)
		}
	}
}
