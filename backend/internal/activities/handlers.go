package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

// RequestContext correlates a business outcome; it never supplies identity or success.
type RequestContext struct{ ID, SessionID, InteractionID pgtype.UUID }

func ReadRequestContext(request *http.Request) (RequestContext, error) {
	var tracking RequestContext
	values := []struct {
		name        string
		destination *pgtype.UUID
	}{
		{"X-Activity-ID", &tracking.ID}, {"X-Activity-Session", &tracking.SessionID},
		{"X-Activity-Interaction", &tracking.InteractionID},
	}
	present := 0
	for _, value := range values {
		raw := request.Header.Get(value.name)
		if raw == "" {
			continue
		}
		if err := value.destination.Scan(raw); err != nil || !value.destination.Valid || value.destination.Bytes == [16]byte{} {
			return tracking, fmt.Errorf("invalid %s", value.name)
		}
		present++
	}
	if present != 0 && present != len(values) {
		return tracking, errors.New("all three activity correlation headers are required together")
	}
	return tracking, nil
}

// RecordOutcome must use the transaction which makes the business change.
func RecordOutcome(ctx context.Context, queries *database.Queries, actor, eventID pgtype.UUID,
	action database.ActivityAction, source database.ActivitySource, tracking RequestContext, extra map[string]any) error {
	snapshot, err := queries.GetActivitySnapshot(ctx, eventID)
	if err != nil {
		return err
	}
	details := map[string]any{}
	if err = json.Unmarshal(snapshot, &details); err != nil {
		return err
	}
	for key, value := range extra {
		details[key] = value
	}
	body, err := json.Marshal(details)
	if err != nil {
		return err
	}
	inserted, err := queries.InsertActivity(ctx, database.InsertActivityParams{
		ID: tracking.ID, Action: action, UserID: actor, SessionID: tracking.SessionID, InteractionID: tracking.InteractionID,
		TrackableType: database.NullActivityTrackableType{ActivityTrackableType: database.ActivityTrackableTypeEvent, Valid: true},
		TrackableID:   eventID, Source: database.NullActivitySource{ActivitySource: source, Valid: true}, Details: body,
	})
	if err == nil && inserted != 1 {
		return errors.New("activity identity already used")
	}
	return err
}

type Handler struct {
	Queries    *database.Queries
	DemoUserID pgtype.UUID
}

type clientActivity struct {
	ID              pgtype.UUID                     `json:"id"`
	Action          database.ActivityAction         `json:"action"`
	SessionID       pgtype.UUID                     `json:"session_id"`
	InteractionID   pgtype.UUID                     `json:"interaction_id"`
	InteractionStep *int32                          `json:"interaction_step"`
	TrackableType   *database.ActivityTrackableType `json:"trackable_type"`
	TrackableID     pgtype.UUID                     `json:"trackable_id"`
	Source          *database.ActivitySource        `json:"source"`
	OccurredAt      time.Time                       `json:"occurred_at"`
	Details         json.RawMessage                 `json:"details"`
}

func (handler Handler) Ingest(w http.ResponseWriter, request *http.Request) {
	var input struct {
		ActorID    pgtype.UUID       `json:"actor_id"`
		Activities []json.RawMessage `json:"activities"`
	}
	request.Body = http.MaxBytesReader(w, request.Body, 65536)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || len(input.Activities) < 1 || len(input.Activities) > 50 {
		http.Error(w, "expected actor_id and 1 to 50 activities (64 KiB maximum)", 400)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "expected one JSON object", 400)
		return
	}
	exists, err := handler.Queries.DemoUserExists(request.Context(), handler.DemoUserID)
	if err != nil || !exists {
		http.Error(w, "activity identity unavailable", 503)
		return
	}
	if !input.ActorID.Valid || input.ActorID != handler.DemoUserID {
		http.Error(w, "activity queue belongs to a different identity", 409)
		return
	}
	type result struct {
		ID     pgtype.UUID `json:"id"`
		Status string      `json:"status"`
		Error  string      `json:"error,omitempty"`
	}
	results := make([]result, 0, len(input.Activities))
	for _, raw := range input.Activities {
		var activity clientActivity
		decoder := json.NewDecoder(bytes.NewReader(raw))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&activity); err != nil {
			results = append(results, result{ID: activity.ID, Status: "rejected", Error: "invalid activity object"})
			continue
		}
		if err := activity.validate(time.Now()); err != nil {
			results = append(results, result{ID: activity.ID, Status: "rejected", Error: err.Error()})
			continue
		}
		var trackable database.NullActivityTrackableType
		if activity.TrackableType != nil {
			trackable = database.NullActivityTrackableType{ActivityTrackableType: *activity.TrackableType, Valid: true}
		}
		var step pgtype.Int4
		if activity.InteractionStep != nil {
			step = pgtype.Int4{Int32: *activity.InteractionStep, Valid: true}
		}
		var source database.NullActivitySource
		if activity.Source != nil {
			source = database.NullActivitySource{ActivitySource: *activity.Source, Valid: true}
		}
		params := database.InsertActivityParams{
			ID: activity.ID, Action: activity.Action, UserID: handler.DemoUserID, SessionID: activity.SessionID,
			InteractionID: activity.InteractionID, InteractionStep: step,
			TrackableType: trackable,
			TrackableID:   activity.TrackableID, Source: source,
			OccurredAt: pgtype.Timestamptz{Time: activity.OccurredAt, Valid: true}, Details: activity.Details,
		}
		saved, readErr := handler.Queries.GetActivity(request.Context(), activity.ID)
		if readErr != nil && !errors.Is(readErr, pgx.ErrNoRows) {
			http.Error(w, "could not read activity", 500)
			return
		}
		if errors.Is(readErr, pgx.ErrNoRows) {
			found := true
			var targetErr error
			if trackable.Valid {
				found, targetErr = handler.Queries.ActivityTargetExists(request.Context(), database.ActivityTargetExistsParams{TrackableType: trackable.ActivityTrackableType, TrackableID: activity.TrackableID})
			}
			if targetErr != nil {
				http.Error(w, "could not validate activity target", 500)
				return
			}
			if !found {
				results = append(results, result{ID: activity.ID, Status: "rejected", Error: "target not found"})
				continue
			}
			inserted, insertErr := handler.Queries.InsertActivity(request.Context(), params)
			if insertErr != nil {
				log.Printf("insert activity: %v", insertErr)
				http.Error(w, "could not store activities", 500)
				return
			}
			if inserted == 1 {
				results = append(results, result{ID: activity.ID, Status: "accepted"})
				continue
			}
			saved, readErr = handler.Queries.GetActivity(request.Context(), activity.ID)
		}
		// A unique step occupied by another ID is also a permanent conflict.
		if readErr != nil || saved.Action != params.Action || saved.UserID != params.UserID || saved.SessionID != params.SessionID ||
			saved.InteractionID != params.InteractionID || saved.InteractionStep != params.InteractionStep ||
			saved.TrackableType != params.TrackableType || saved.TrackableID != params.TrackableID || saved.Source != params.Source ||
			!saved.OccurredAt.Time.Equal(params.OccurredAt.Time.Truncate(time.Microsecond)) || !sameJSON(saved.Details, params.Details) {
			results = append(results, result{ID: activity.ID, Status: "conflict", Error: "activity ID or interaction step already has different content"})
			continue
		}
		results = append(results, result{ID: activity.ID, Status: "accepted"})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		Results []result `json:"results"`
	}{results})
}

func sameJSON(first, second []byte) bool {
	var a, b any
	if json.Unmarshal(first, &a) != nil || json.Unmarshal(second, &b) != nil {
		return false
	}
	canonicalA, _ := json.Marshal(a)
	canonicalB, _ := json.Marshal(b)
	return bytes.Equal(canonicalA, canonicalB)
}

func (activity clientActivity) validate(now time.Time) error {
	for _, id := range []pgtype.UUID{activity.ID, activity.SessionID} {
		if !id.Valid || id.Bytes == [16]byte{} {
			return errors.New("nonzero activity and session UUIDs required")
		}
	}
	if activity.OccurredAt.Before(now.Add(-7*24*time.Hour)) || activity.OccurredAt.After(now.Add(5*time.Minute)) {
		return errors.New("invalid activity time (seven-day history, five-minute clock tolerance)")
	}
	// Room for place_pinned's names: 20 names of 80 letters, 2 to 3 bytes each in Urdu script.
	if len(activity.Details) > 8192 {
		return errors.New("details too large")
	}
	var targetType database.ActivityTrackableType
	if activity.TrackableType != nil {
		targetType = *activity.TrackableType
	}
	if (activity.TrackableType != nil) != activity.TrackableID.Valid ||
		(activity.TrackableID.Valid && activity.TrackableID.Bytes == [16]byte{}) ||
		(activity.TrackableType != nil && targetType != database.ActivityTrackableTypeEvent && targetType != database.ActivityTrackableTypePlace && targetType != database.ActivityTrackableTypeArea) {
		return errors.New("trackable type and nonzero ID must both be supplied or null")
	}
	if activity.Action == database.ActivityActionSessionStarted {
		if activity.ID != activity.SessionID || activity.InteractionID.Valid || activity.InteractionStep != nil || activity.Source != nil || activity.TrackableType != nil {
			return errors.New("session start uses its session ID as activity ID and null interaction, step, source and trackable")
		}
		var details map[string]json.RawMessage
		if err := json.Unmarshal(activity.Details, &details); err != nil || details == nil || len(details) != 0 {
			return errors.New("session start details must be an empty object")
		}
		return nil
	}
	if !activity.InteractionID.Valid || activity.InteractionID.Bytes == [16]byte{} || activity.InteractionStep == nil || *activity.InteractionStep < 1 || activity.Source == nil {
		return errors.New("screen activities require a nonzero interaction UUID, positive step and source")
	}
	step, source := *activity.InteractionStep, *activity.Source
	// Opening a city or district page is one instantaneous interaction; the client
	// sends it at most once per session for each area.
	if activity.Action == database.ActivityActionAreaViewed {
		if targetType != database.ActivityTrackableTypeArea || source != database.ActivitySourceExplore || step != 1 {
			return errors.New("area views target an area from explore at step one")
		}
		var details map[string]json.RawMessage
		if err := json.Unmarshal(activity.Details, &details); err != nil || details == nil || len(details) != 0 {
			return errors.New("area view details must be an empty object")
		}
		return nil
	}
	if activity.Action == database.ActivityActionEventShared || activity.Action == database.ActivityActionCelebrationClosed {
		return validateShare(activity.Action, targetType, source, step, activity.InteractionID, activity.Details)
	}
	if activity.Action == database.ActivityActionPlaceViewed {
		if targetType != database.ActivityTrackableTypePlace || source != database.ActivitySourceExplore || step != 1 {
			return errors.New("place views target a place from explore at step one")
		}
		var details struct {
			Referrer *pgtype.UUID `json:"referrer_interaction_id"`
			Elapsed  *int64       `json:"elapsed_ms"`
			Active   *int64       `json:"active_ms"`
		}
		decoder := json.NewDecoder(bytes.NewReader(activity.Details))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&details); err != nil || details.Referrer == nil || !details.Referrer.Valid || details.Referrer.Bytes == [16]byte{} || *details.Referrer == activity.InteractionID ||
			details.Elapsed == nil || details.Active == nil || *details.Elapsed != 0 || *details.Active != 0 {
			return errors.New("place views require a distinct referrer and zero timing")
		}
		return nil
	}
	// The create flow can start before a place is picked (from the ＋), so its
	// form activities and the place picker's own activities may have no target.
	placeOrNone := activity.TrackableType == nil || targetType == database.ActivityTrackableTypePlace

	var details struct {
		Elapsed    *int64       `json:"elapsed_ms"`
		Active     *int64       `json:"active_ms"`
		Attempt    *int32       `json:"attempt_number,omitempty"`
		Reason     string       `json:"reason,omitempty"`
		ViewerRole string       `json:"viewer_role,omitempty"`
		Referrer   *pgtype.UUID `json:"referrer_interaction_id,omitempty"`
		Entry      string       `json:"entry,omitempty"`
		// Place picker details.
		Via         string  `json:"via,omitempty"`
		Position    *int32  `json:"position,omitempty"`
		ResultCount *int32  `json:"result_count,omitempty"`
		Query       *string `json:"query,omitempty"`
		LocationOn  *bool   `json:"location_on,omitempty"`
		Answer      string  `json:"answer,omitempty"`
		// Pin details.
		District           string   `json:"district,omitempty"`
		DuplicateSuggested *bool    `json:"duplicate_suggested,omitempty"`
		DuplicateIgnored   *bool    `json:"duplicate_ignored,omitempty"`
		Private            *bool    `json:"private,omitempty"`
		Kind               string   `json:"kind,omitempty"`
		Names              []string `json:"names,omitempty"`
		RenameCount        *int32   `json:"rename_count,omitempty"`
		Snapshot           *struct {
			Count    *int32    `json:"participant_count"`
			Capacity *int32    `json:"capacity"`
			StartsAt time.Time `json:"starts_at"`
			Status   string    `json:"status"`
		} `json:"snapshot,omitempty"`
	}
	decoder := json.NewDecoder(bytes.NewReader(activity.Details))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&details); err != nil || details.Elapsed == nil || details.Active == nil {
		return errors.New("details require integer elapsed_ms and active_ms")
	}
	if *details.Active < 0 || *details.Elapsed < *details.Active || *details.Elapsed > 9007199254740991 {
		return errors.New("invalid durations")
	}
	switch activity.Action {
	case database.ActivityActionEventCreationStarted:
		if !placeOrNone || source != database.ActivitySourceEventForm {
			return errors.New("creation starts from event_form, with a place or none")
		}
	case database.ActivityActionEventCreationSubmitted:
		// No target when the place is a new pin, created together with the event.
		if !placeOrNone || source != database.ActivitySourceEventForm {
			return errors.New("creation is submitted from event_form, with a place or a new pin")
		}
	case database.ActivityActionPlaceSearchSelected:
		if targetType != database.ActivityTrackableTypePlace || source != database.ActivitySourceEventForm {
			return errors.New("place search selection targets the picked place from event_form")
		}
	case database.ActivityActionPlaceSearchAbandoned, database.ActivityActionLocationPermissionAnswered, database.ActivityActionPlacePinned:
		if activity.TrackableType != nil || source != database.ActivitySourceEventForm {
			return errors.New("this picker activity comes from event_form with no target")
		}
	case database.ActivityActionEventViewed:
		if targetType != database.ActivityTrackableTypeEvent || (source != database.ActivitySourcePlaceDetails && source != database.ActivitySourceYourEvents && source != database.ActivitySourceProfile && source != database.ActivitySourceExplore) {
			return errors.New("invalid event view target/source")
		}
	case database.ActivityActionChatOpened:
		if targetType != database.ActivityTrackableTypeEvent || source != database.ActivitySourceEventDetails {
			return errors.New("chat opening targets an event from event_details")
		}
	case database.ActivityActionJoinAttempted:
		if targetType != database.ActivityTrackableTypeEvent || source != database.ActivitySourceEventDetails {
			return errors.New("invalid join target/source")
		}
	case database.ActivityActionInteractionPaused, database.ActivityActionInteractionResumed, database.ActivityActionInteractionClosed:
		if !((placeOrNone && source == database.ActivitySourceEventForm) ||
			(targetType == database.ActivityTrackableTypeEvent && (source == database.ActivitySourceEventDetails || source == database.ActivitySourceEventChat)) ||
			(targetType == database.ActivityTrackableTypePlace && source == database.ActivitySourcePlaceDetails)) {
			return errors.New("invalid lifecycle target/source")
		}
	default:
		return errors.New("action is not enabled for client ingestion")
	}
	switch activity.Action {
	case database.ActivityActionEventCreationStarted, database.ActivityActionEventViewed, database.ActivityActionChatOpened:
		if step != 1 || *details.Elapsed != 0 || *details.Active != 0 {
			return errors.New("start must be step one with zero timing")
		}
	default:
		if step < 2 {
			return errors.New("subsequent activities need step two or later")
		}
	}
	submitted := activity.Action == database.ActivityActionEventCreationSubmitted || activity.Action == database.ActivityActionJoinAttempted
	if submitted != (details.Attempt != nil) || (details.Attempt != nil && *details.Attempt < 1) {
		return errors.New("attempt_number is required only for submissions")
	}
	if activity.Action == database.ActivityActionEventViewed {
		snapshot := details.Snapshot
		if snapshot == nil || snapshot.Count == nil || *snapshot.Count < 0 || snapshot.Capacity == nil || *snapshot.Capacity < 1 || snapshot.StartsAt.IsZero() ||
			(snapshot.Status != "scheduled" && snapshot.Status != "cancelled" && snapshot.Status != "completed") ||
			(details.ViewerRole != "host" && details.ViewerRole != "participant" && details.ViewerRole != "visitor") {
			return errors.New("event view requires snapshot and viewer_role")
		}
	} else if details.Snapshot != nil || details.ViewerRole != "" {
		return errors.New("snapshot/viewer_role only allowed on views")
	}
	if activity.Action == database.ActivityActionInteractionPaused {
		if details.Reason != "app_backgrounded" && details.Reason != "screen_hidden" {
			return errors.New("invalid pause reason")
		}
	} else if activity.Action == database.ActivityActionInteractionClosed {
		if details.Reason != "dismissed" && details.Reason != "completed" {
			return errors.New("invalid close reason")
		}
	} else if activity.Action == database.ActivityActionPlaceSearchAbandoned {
		if details.Reason != "back" && details.Reason != "closed" {
			return errors.New("abandoned searches need reason back or closed")
		}
	} else if details.Reason != "" {
		return errors.New("reason not allowed for action")
	}
	// Explicit nulls and irrelevant keys must not bypass the per-action contract.
	var keys map[string]json.RawMessage
	json.Unmarshal(activity.Details, &keys)
	allowed := map[string]bool{"elapsed_ms": true, "active_ms": true}
	if submitted {
		allowed["attempt_number"] = true
	}
	if activity.Action == database.ActivityActionEventViewed {
		allowed["snapshot"] = true
		allowed["viewer_role"] = true
		allowed["referrer_interaction_id"] = true
		if _, present := keys["referrer_interaction_id"]; present && (details.Referrer == nil || !details.Referrer.Valid || details.Referrer.Bytes == [16]byte{} || *details.Referrer == activity.InteractionID) {
			return errors.New("invalid referrer interaction ID")
		}
	}
	if activity.Action == database.ActivityActionInteractionPaused || activity.Action == database.ActivityActionInteractionClosed ||
		activity.Action == database.ActivityActionPlaceSearchAbandoned {
		allowed["reason"] = true
	}
	if err := validatePicker(activity.Action, keys, details.Via, details.Position, details.ResultCount, details.Query, details.LocationOn, details.Answer, allowed); err != nil {
		return err
	}
	if activity.Action == database.ActivityActionPlacePinned {
		for _, key := range []string{"via", "district", "duplicate_suggested", "duplicate_ignored", "private", "kind", "names", "rename_count"} {
			allowed[key] = true
		}
		if err := validatePin(details.Via, details.District, details.DuplicateSuggested, details.DuplicateIgnored,
			details.Private, details.Kind, details.Names, details.RenameCount); err != nil {
			return err
		}
	}
	// Where the host opened the form: the bottom-bar ＋ or a place card's link.
	if activity.Action == database.ActivityActionEventCreationStarted {
		allowed["entry"] = true
		if _, present := keys["entry"]; present && details.Entry != "create_tab" && details.Entry != "place_card" {
			return errors.New("entry must be create_tab or place_card")
		}
	}
	for key := range keys {
		if !allowed[key] {
			return fmt.Errorf("detail %s not allowed for action", key)
		}
	}
	return nil
}

// validatePicker checks the place picker's details and marks its keys allowed:
//   - place_search_selected: via, position, result_count, query, location_on
//   - place_search_abandoned: query, result_count, location_on (reason is checked above)
//   - location_permission_answered: answer
//
// position is the 1-based rank in the list or search results; it is null when the
// place was picked from a map dot or the pin's duplicate check, which have no rank.
func validatePicker(action database.ActivityAction, keys map[string]json.RawMessage, via string, position, resultCount *int32,
	query *string, locationOn *bool, answer string, allowed map[string]bool) error {
	searchDetails := func() error {
		for _, key := range []string{"query", "result_count", "location_on"} {
			allowed[key] = true
		}
		if query == nil || utf8.RuneCountInString(*query) > 100 || resultCount == nil || *resultCount < 0 || locationOn == nil {
			return errors.New("picker activities need query (0 to 100 characters), result_count and location_on")
		}
		return nil
	}
	switch action {
	case database.ActivityActionPlaceSearchSelected:
		allowed["via"], allowed["position"] = true, true
		if err := searchDetails(); err != nil {
			return err
		}
		if _, present := keys["position"]; !present {
			return errors.New("position is required (null for map_dot and pin_duplicate_check)")
		}
		switch via {
		case "list", "search":
			if position == nil || *position < 1 {
				return errors.New("list and search picks need a position of 1 or more")
			}
		case "map_dot", "pin_duplicate_check":
			if position != nil {
				return errors.New("map_dot and pin_duplicate_check picks have a null position")
			}
		default:
			return errors.New("via must be map_dot, list, search or pin_duplicate_check")
		}
	case database.ActivityActionPlaceSearchAbandoned:
		return searchDetails()
	case database.ActivityActionLocationPermissionAnswered:
		allowed["answer"] = true
		if answer != "while_using" && answer != "only_this_time" && answer != "denied" {
			return errors.New("answer must be while_using, only_this_time or denied")
		}
	}
	return nil
}

var districtSlug = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

// validatePin checks place_pinned: how the pin started, its district, the
// duplicate check, privacy, whether the kind was a chip or typed, and every
// name typed along the way (rename_count is one less than the names).
func validatePin(via, district string, suggested, ignored, private *bool, kind string, names []string, renames *int32) error {
	if via != "cant_find" && via != "pin_button" && via != "long_press" {
		return errors.New("via must be cant_find, pin_button or long_press")
	}
	if len(district) > 100 || !districtSlug.MatchString(district) {
		return errors.New("district must be a district slug")
	}
	if suggested == nil || ignored == nil || private == nil {
		return errors.New("duplicate_suggested, duplicate_ignored and private are required")
	}
	if *ignored && !*suggested {
		return errors.New("a duplicate can only be ignored when one was suggested")
	}
	if kind != "chip" && kind != "typed" {
		return errors.New("kind must be chip or typed")
	}
	if len(names) < 1 || len(names) > 20 {
		return errors.New("names must list 1 to 20 names")
	}
	for _, name := range names {
		if length := utf8.RuneCountInString(name); length < 1 || length > 80 {
			return errors.New("each name must be 1 to 80 characters")
		}
	}
	if renames == nil || int(*renames) != len(names)-1 {
		return errors.New("rename_count must be one less than the number of names")
	}
	return nil
}

// validateShare checks the two sharing moments, each its own interaction at step one
// on an event. event_shared: via whatsapp or share_sheet, from the celebration or event
// details. celebration_closed: how it closed and how long it showed. Both carry the
// interaction they came from (creation, or the details screen) as referrer.
func validateShare(action database.ActivityAction, target database.ActivityTrackableType, source database.ActivitySource,
	step int32, interaction pgtype.UUID, raw json.RawMessage) error {
	if target != database.ActivityTrackableTypeEvent || step != 1 {
		return errors.New("sharing activities target an event at step one")
	}
	var details struct {
		Via      string       `json:"via"`
		How      string       `json:"how"`
		ShownMS  *int64       `json:"shown_ms"`
		Referrer *pgtype.UUID `json:"referrer_interaction_id"`
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&details); err != nil {
		return errors.New("invalid sharing details")
	}
	if details.Referrer == nil || !details.Referrer.Valid || details.Referrer.Bytes == [16]byte{} || *details.Referrer == interaction {
		return errors.New("sharing activities need a distinct referrer_interaction_id")
	}
	if action == database.ActivityActionEventShared {
		if source != database.ActivitySourceCelebration && source != database.ActivitySourceEventDetails {
			return errors.New("events are shared from the celebration or event details")
		}
		if details.Via != "whatsapp" && details.Via != "share_sheet" {
			return errors.New("via must be whatsapp or share_sheet")
		}
		if details.How != "" || details.ShownMS != nil {
			return errors.New("how and shown_ms belong to celebration_closed")
		}
		return nil
	}
	if source != database.ActivitySourceCelebration {
		return errors.New("celebration_closed comes from the celebration")
	}
	switch details.How {
	case "whatsapp", "share_sheet", "map", "timed_out", "dismissed":
	default:
		return errors.New("how must be whatsapp, share_sheet, map, timed_out or dismissed")
	}
	if details.ShownMS == nil || *details.ShownMS < 0 || *details.ShownMS > 3600000 {
		return errors.New("shown_ms must be 0 to 3600000")
	}
	if details.Via != "" {
		return errors.New("via belongs to event_shared")
	}
	return nil
}
