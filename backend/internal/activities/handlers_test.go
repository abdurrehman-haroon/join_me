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

func TestExploreActivityContract(t *testing.T) {
	const placeID = "30000000-0000-4000-8000-000000000008"
	const referrerID = "30000000-0000-4000-8000-000000000009"
	cases := []struct {
		name, action, source, targetType, targetID, details string
		step                                                int32
		valid                                               bool
	}{
		{"place overlay", "interaction_paused", "place_details", `"place"`, `"` + placeID + `"`, `{"reason":"screen_hidden","elapsed_ms":9000,"active_ms":8000}`, 3, true},
		{"place view from explore", "place_viewed", "explore", `"place"`, `"` + placeID + `"`, `{"referrer_interaction_id":"` + referrerID + `","elapsed_ms":0,"active_ms":0}`, 1, true},
		{"explore place view has no sport", "place_viewed", "explore", `"place"`, `"` + placeID + `"`, `{"sport":"all","referrer_interaction_id":"` + referrerID + `","elapsed_ms":0,"active_ms":0}`, 1, false},
		{"map place view retired", "place_viewed", "map", `"place"`, `"` + placeID + `"`, `{"sport":"all","referrer_interaction_id":"` + referrerID + `","elapsed_ms":0,"active_ms":0}`, 1, false},
		{"place referrer required", "place_viewed", "explore", `"place"`, `"` + placeID + `"`, `{"elapsed_ms":0,"active_ms":0}`, 1, false},
		{"place starts at zero", "place_viewed", "explore", `"place"`, `"` + placeID + `"`, `{"referrer_interaction_id":"` + referrerID + `","elapsed_ms":5,"active_ms":5}`, 1, false},
		{"place starts at step one", "place_viewed", "explore", `"place"`, `"` + placeID + `"`, `{"referrer_interaction_id":"` + referrerID + `","elapsed_ms":0,"active_ms":0}`, 2, false},
		{"sport filter retired", "sport_filter_selected", "map", "null", "null", `{"sport":"cricket"}`, 1, false},
		{"empty result retired", "empty_results_viewed", "map", "null", "null", `{"sport":"all","empty_kind":"no_events"}`, 1, false},
		{"area view", "area_viewed", "explore", `"area"`, `"` + placeID + `"`, `{}`, 1, true},
		{"area view needs explore", "area_viewed", "map", `"area"`, `"` + placeID + `"`, `{}`, 1, false},
		{"area view targets area", "area_viewed", "explore", `"place"`, `"` + placeID + `"`, `{}`, 1, false},
		{"area view starts at step one", "area_viewed", "explore", `"area"`, `"` + placeID + `"`, `{}`, 2, false},
		{"area view has no details", "area_viewed", "explore", `"area"`, `"` + placeID + `"`, `{"sport":"all"}`, 1, false},
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

func TestProfileEventView(t *testing.T) {
	var viewed clientActivity
	body := fmt.Sprintf(`{"id":"30000000-0000-4000-8000-000000000001","action":"event_viewed","session_id":"30000000-0000-4000-8000-000000000002","interaction_id":"30000000-0000-4000-8000-000000000003","interaction_step":1,"trackable_type":"event","trackable_id":"30000000-0000-4000-8000-000000000004","source":"profile","occurred_at":%q,"details":{"elapsed_ms":0,"active_ms":0,"viewer_role":"participant","snapshot":{"participant_count":2,"capacity":10,"starts_at":"2026-10-20T12:00:00Z","status":"scheduled"}}}`, time.Now().UTC().Format(time.RFC3339Nano))
	if err := json.Unmarshal([]byte(body), &viewed); err != nil {
		t.Fatal(err)
	}
	if err := viewed.validate(time.Now()); err != nil {
		t.Fatal(err)
	}
	viewed.Action = database.ActivityActionJoinAttempted
	if viewed.validate(time.Now()) == nil {
		t.Fatal("profile source accepted for join attempt")
	}
}

func TestExploreEventView(t *testing.T) {
	var viewed clientActivity
	body := fmt.Sprintf(`{"id":"30000000-0000-4000-8000-000000000001","action":"event_viewed","session_id":"30000000-0000-4000-8000-000000000002","interaction_id":"30000000-0000-4000-8000-000000000003","interaction_step":1,"trackable_type":"event","trackable_id":"30000000-0000-4000-8000-000000000004","source":"explore","occurred_at":%q,"details":{"elapsed_ms":0,"active_ms":0,"viewer_role":"visitor","referrer_interaction_id":"30000000-0000-4000-8000-000000000005","snapshot":{"participant_count":2,"capacity":10,"starts_at":"2026-10-20T12:00:00Z","status":"scheduled"}}}`, time.Now().UTC().Format(time.RFC3339Nano))
	if err := json.Unmarshal([]byte(body), &viewed); err != nil {
		t.Fatal(err)
	}
	if err := viewed.validate(time.Now()); err != nil {
		t.Fatal(err)
	}
}
