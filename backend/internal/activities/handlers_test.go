package activities

import (
	"encoding/json"
	"fmt"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
	"strings"
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

func TestCreationStartEntry(t *testing.T) {
	var id pgtype.UUID
	id.Scan("30000000-0000-4000-8000-000000000001")
	placeType := database.ActivityTrackableTypePlace
	formSource := database.ActivitySourceEventForm
	firstStep := int32(1)
	started := clientActivity{ID: id, SessionID: id, InteractionID: id, InteractionStep: &firstStep,
		Action: database.ActivityActionEventCreationStarted, TrackableType: &placeType, TrackableID: id,
		Source: &formSource, OccurredAt: time.Now()}
	for _, details := range []string{
		`{"elapsed_ms":0,"active_ms":0}`,
		`{"elapsed_ms":0,"active_ms":0,"entry":"create_tab"}`,
		`{"elapsed_ms":0,"active_ms":0,"entry":"place_card"}`,
	} {
		started.Details = json.RawMessage(details)
		if err := started.validate(time.Now()); err != nil {
			t.Fatalf("rejected %s: %v", details, err)
		}
	}
	for _, details := range []string{
		`{"elapsed_ms":0,"active_ms":0,"entry":"map"}`,
		`{"elapsed_ms":0,"active_ms":0,"entry":null}`,
	} {
		started.Details = json.RawMessage(details)
		if started.validate(time.Now()) == nil {
			t.Fatalf("accepted %s", details)
		}
	}
	// Only the start says where the form was opened from.
	submitted := started
	submitted.Action = database.ActivityActionEventCreationSubmitted
	secondStep := int32(2)
	submitted.InteractionStep = &secondStep
	submitted.Details = json.RawMessage(`{"elapsed_ms":10,"active_ms":10,"attempt_number":1,"entry":"create_tab"}`)
	if submitted.validate(time.Now()) == nil {
		t.Fatal("accepted entry on a submission")
	}
}

// The ＋ can open the form before a place is picked, and a submission has no
// place when it creates a new pin.
func TestCreationWithoutPlace(t *testing.T) {
	var id pgtype.UUID
	id.Scan("30000000-0000-4000-8000-000000000002")
	formSource := database.ActivitySourceEventForm
	firstStep, secondStep := int32(1), int32(2)
	started := clientActivity{ID: id, SessionID: id, InteractionID: id, InteractionStep: &firstStep,
		Action: database.ActivityActionEventCreationStarted, Source: &formSource, OccurredAt: time.Now(),
		Details: json.RawMessage(`{"elapsed_ms":0,"active_ms":0,"entry":"create_tab"}`)}
	if err := started.validate(time.Now()); err != nil {
		t.Fatalf("rejected a start without a place: %v", err)
	}
	closed := started
	closed.Action, closed.InteractionStep = database.ActivityActionInteractionClosed, &secondStep
	closed.Details = json.RawMessage(`{"elapsed_ms":10,"active_ms":10,"reason":"dismissed"}`)
	if err := closed.validate(time.Now()); err != nil {
		t.Fatalf("rejected closing a form without a place: %v", err)
	}
	submitted := closed
	submitted.Action = database.ActivityActionEventCreationSubmitted
	submitted.Details = json.RawMessage(`{"elapsed_ms":10,"active_ms":10,"attempt_number":1}`)
	if err := submitted.validate(time.Now()); err != nil {
		t.Fatalf("rejected a submission for a new pin: %v", err)
	}
	eventType := database.ActivityTrackableTypeEvent
	started.TrackableType, started.TrackableID = &eventType, id
	if started.validate(time.Now()) == nil {
		t.Fatal("accepted a creation start targeting an event")
	}
}

func TestPlacePickerContract(t *testing.T) {
	var id pgtype.UUID
	id.Scan("30000000-0000-4000-8000-000000000003")
	placeType := database.ActivityTrackableTypePlace
	formSource, mapSource := database.ActivitySourceEventForm, database.ActivitySourceMap
	step := int32(3)
	activity := func(action database.ActivityAction, place bool, details string) clientActivity {
		a := clientActivity{ID: id, SessionID: id, InteractionID: id, InteractionStep: &step, Action: action,
			Source: &formSource, OccurredAt: time.Now(), Details: json.RawMessage(details)}
		if place {
			a.TrackableType, a.TrackableID = &placeType, id
		}
		return a
	}
	selected, abandoned, answered := database.ActivityActionPlaceSearchSelected, database.ActivityActionPlaceSearchAbandoned,
		database.ActivityActionLocationPermissionAnswered
	accepted := []clientActivity{
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"search","position":1,"result_count":4,"query":"gloria","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"list","position":12,"result_count":80,"query":"","location_on":false}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"map_dot","position":null,"result_count":80,"query":"","location_on":false}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"pin_duplicate_check","position":null,"result_count":1,"query":"cosa","location_on":true}`),
		activity(abandoned, false, `{"elapsed_ms":9,"active_ms":9,"query":"chai","result_count":0,"location_on":false,"reason":"back"}`),
		activity(abandoned, false, `{"elapsed_ms":9,"active_ms":9,"query":"","result_count":30,"location_on":true,"reason":"closed"}`),
		activity(answered, false, `{"elapsed_ms":9,"active_ms":9,"answer":"while_using"}`),
		activity(answered, false, `{"elapsed_ms":9,"active_ms":9,"answer":"only_this_time"}`),
		activity(answered, false, `{"elapsed_ms":9,"active_ms":9,"answer":"denied"}`),
	}
	for _, a := range accepted {
		if err := a.validate(time.Now()); err != nil {
			t.Fatalf("rejected %s %s: %v", a.Action, a.Details, err)
		}
	}
	long := strings.Repeat("a", 101)
	rejected := []clientActivity{
		// Selection needs the picked place, a known via and a matching position.
		activity(selected, false, `{"elapsed_ms":9,"active_ms":9,"via":"search","position":1,"result_count":4,"query":"g","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"nearby","position":1,"result_count":4,"query":"g","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"search","position":null,"result_count":4,"query":"g","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"search","position":0,"result_count":4,"query":"g","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"map_dot","position":2,"result_count":4,"query":"","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"map_dot","result_count":4,"query":"","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"list","position":1,"query":"","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"list","position":1,"result_count":4,"query":"`+long+`","location_on":true}`),
		activity(selected, true, `{"elapsed_ms":9,"active_ms":9,"via":"list","position":1,"result_count":4,"query":"","location_on":true,"answer":"denied"}`),
		// Abandoning has no target and needs a known reason.
		activity(abandoned, true, `{"elapsed_ms":9,"active_ms":9,"query":"","result_count":0,"location_on":false,"reason":"back"}`),
		activity(abandoned, false, `{"elapsed_ms":9,"active_ms":9,"query":"","result_count":0,"location_on":false,"reason":"dismissed"}`),
		activity(abandoned, false, `{"elapsed_ms":9,"active_ms":9,"query":"","result_count":-1,"location_on":false,"reason":"back"}`),
		// The permission answer is one of three, and never carries a location.
		activity(answered, false, `{"elapsed_ms":9,"active_ms":9,"answer":"yes"}`),
		activity(answered, false, `{"elapsed_ms":9,"active_ms":9,"answer":"denied","latitude":31.5}`),
	}
	for _, a := range rejected {
		if a.validate(time.Now()) == nil {
			t.Fatalf("accepted %s %s", a.Action, a.Details)
		}
	}
	// Picker activities belong to the form and come after its start.
	wrongSource := activity(answered, false, `{"elapsed_ms":9,"active_ms":9,"answer":"denied"}`)
	wrongSource.Source = &mapSource
	firstStep := int32(1)
	tooEarly := activity(answered, false, `{"elapsed_ms":0,"active_ms":0,"answer":"denied"}`)
	tooEarly.InteractionStep = &firstStep
	for _, a := range []clientActivity{wrongSource, tooEarly} {
		if a.validate(time.Now()) == nil {
			t.Fatalf("accepted %s from %s at step %d", a.Action, *a.Source, *a.InteractionStep)
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

func TestPlacePinnedContract(t *testing.T) {
	var id pgtype.UUID
	id.Scan("30000000-0000-4000-8000-000000000004")
	placeType := database.ActivityTrackableTypePlace
	formSource := database.ActivitySourceEventForm
	step := int32(4)
	pinned := func(details string) clientActivity {
		return clientActivity{ID: id, SessionID: id, InteractionID: id, InteractionStep: &step,
			Action: database.ActivityActionPlacePinned, Source: &formSource, OccurredAt: time.Now(), Details: json.RawMessage(details)}
	}
	base := `"elapsed_ms":9,"active_ms":9,"district":"gulberg","duplicate_suggested":true,"duplicate_ignored":true,"private":false,"kind":"chip"`
	urdu := strings.Repeat("چائے", 20)
	twenty := strings.TrimSuffix(strings.Repeat(`"`+urdu+`",`, 20), ",")
	for _, details := range []string{
		`{` + base + `,"via":"cant_find","names":["Chai Adda"],"rename_count":0}`,
		`{` + base + `,"via":"long_press","names":["Chai","Chai Ad","Chai Adda"],"rename_count":2}`,
		`{` + base + `,"via":"pin_button","names":[` + twenty + `],"rename_count":19}`,
	} {
		if err := pinned(details).validate(time.Now()); err != nil {
			t.Fatalf("rejected %.120s: %v", details, err)
		}
	}
	withPlace := pinned(`{` + base + `,"via":"cant_find","names":["Chai Adda"],"rename_count":0}`)
	withPlace.TrackableType, withPlace.TrackableID = &placeType, id
	rejected := []clientActivity{withPlace}
	for _, details := range []string{
		`{` + base + `,"via":"search","names":["Chai Adda"],"rename_count":0}`,
		`{` + base + `,"via":"cant_find","names":[],"rename_count":-1}`,
		`{` + base + `,"via":"cant_find","names":["Chai","Chai Adda"],"rename_count":0}`,
		`{` + base + `,"via":"cant_find","names":[""],"rename_count":0}`,
		`{` + base + `,"via":"cant_find","names":["` + strings.Repeat("a", 81) + `"],"rename_count":0}`,
		`{` + base + `,"via":"cant_find","names":[` + twenty + `,"one more"],"rename_count":20}`,
		`{` + strings.Replace(base, `"kind":"chip"`, `"kind":"other"`, 1) + `,"via":"cant_find","names":["Chai"],"rename_count":0}`,
		`{` + strings.Replace(base, `"district":"gulberg"`, `"district":"Gulberg Town"`, 1) + `,"via":"cant_find","names":["Chai"],"rename_count":0}`,
		`{` + strings.Replace(base, `"duplicate_suggested":true`, `"duplicate_suggested":false`, 1) + `,"via":"cant_find","names":["Chai"],"rename_count":0}`,
		`{` + strings.Replace(base, `,"private":false`, ``, 1) + `,"via":"cant_find","names":["Chai"],"rename_count":0}`,
		`{` + base + `,"via":"cant_find","names":["Chai"],"rename_count":0,"coordinates":[74.3,31.5]}`,
	} {
		rejected = append(rejected, pinned(details))
	}
	for _, activity := range rejected {
		if activity.validate(time.Now()) == nil {
			t.Fatalf("accepted %.160s", activity.Details)
		}
	}
}

func TestSharingContract(t *testing.T) {
	var id pgtype.UUID
	id.Scan("30000000-0000-4000-8000-000000000005")
	eventType, placeType := database.ActivityTrackableTypeEvent, database.ActivityTrackableTypePlace
	celebration, details, form := database.ActivitySourceCelebration, database.ActivitySourceEventDetails, database.ActivitySourceEventForm
	first, second := int32(1), int32(2)
	moment := func(action database.ActivityAction, source *database.ActivitySource, body string) clientActivity {
		return clientActivity{ID: id, SessionID: id, InteractionID: id, InteractionStep: &first, Action: action,
			TrackableType: &eventType, TrackableID: id, Source: source, OccurredAt: time.Now(), Details: json.RawMessage(body)}
	}
	shared, closed := database.ActivityActionEventShared, database.ActivityActionCelebrationClosed
	referrer := `"referrer_interaction_id":"30000000-0000-4000-8000-000000000006"`
	for _, activity := range []clientActivity{
		moment(shared, &celebration, `{"via":"whatsapp",`+referrer+`}`),
		moment(shared, &details, `{"via":"share_sheet",`+referrer+`}`),
		moment(closed, &celebration, `{"how":"timed_out","shown_ms":5000,`+referrer+`}`),
		moment(closed, &celebration, `{"how":"map","shown_ms":1200,`+referrer+`}`),
	} {
		if err := activity.validate(time.Now()); err != nil {
			t.Fatalf("rejected %s %s: %v", activity.Action, activity.Details, err)
		}
	}
	onPlace := moment(shared, &celebration, `{"via":"whatsapp",`+referrer+`}`)
	onPlace.TrackableType = &placeType
	laterStep := moment(closed, &celebration, `{"how":"map","shown_ms":1,`+referrer+`}`)
	laterStep.InteractionStep = &second
	selfReferrer := moment(shared, &details, `{"via":"whatsapp","referrer_interaction_id":"30000000-0000-4000-8000-000000000005"}`)

	for _, activity := range []clientActivity{
		onPlace, laterStep, selfReferrer,
		moment(shared, &form, `{"via":"whatsapp",`+referrer+`}`),
		moment(shared, &celebration, `{"via":"sms",`+referrer+`}`),
		moment(shared, &celebration, `{"via":"whatsapp"}`),
		moment(shared, &celebration, `{"via":"whatsapp","shown_ms":3,`+referrer+`}`),
		moment(closed, &details, `{"how":"map","shown_ms":1,`+referrer+`}`),
		moment(closed, &celebration, `{"how":"swiped","shown_ms":1,`+referrer+`}`),
		moment(closed, &celebration, `{"how":"map",`+referrer+`}`),
		moment(closed, &celebration, `{"how":"map","shown_ms":-1,`+referrer+`}`),
		moment(closed, &celebration, `{"how":"map","shown_ms":1,"via":"whatsapp",`+referrer+`}`),
		moment(closed, &celebration, `{"how":"map","shown_ms":1,"elapsed_ms":0,`+referrer+`}`),
	} {
		if activity.validate(time.Now()) == nil {
			t.Fatalf("accepted %s from %v: %s", activity.Action, *activity.Source, activity.Details)
		}
	}
}
