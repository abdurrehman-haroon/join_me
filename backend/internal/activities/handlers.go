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
	"time"

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
	if len(activity.Details) > 4096 {
		return errors.New("details too large")
	}
	var targetType database.ActivityTrackableType
	if activity.TrackableType != nil {
		targetType = *activity.TrackableType
	}
	if (activity.TrackableType != nil) != activity.TrackableID.Valid ||
		(activity.TrackableID.Valid && activity.TrackableID.Bytes == [16]byte{}) ||
		(activity.TrackableType != nil && targetType != database.ActivityTrackableTypeEvent && targetType != database.ActivityTrackableTypePlace) {
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
	if activity.Action == database.ActivityActionSportFilterSelected || activity.Action == database.ActivityActionPlaceViewed || activity.Action == database.ActivityActionEmptyResultsViewed {
		return activity.validateDiscovery(targetType, source, step)
	}
	if !activity.TrackableID.Valid {
		return errors.New("this action requires a trackable")
	}

	var details struct {
		Elapsed    *int64       `json:"elapsed_ms"`
		Active     *int64       `json:"active_ms"`
		Attempt    *int32       `json:"attempt_number,omitempty"`
		Reason     string       `json:"reason,omitempty"`
		ViewerRole string       `json:"viewer_role,omitempty"`
		Referrer   *pgtype.UUID `json:"referrer_interaction_id,omitempty"`
		Snapshot   *struct {
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
	case database.ActivityActionEventCreationStarted, database.ActivityActionEventCreationSubmitted:
		if targetType != database.ActivityTrackableTypePlace || source != database.ActivitySourceEventForm {
			return errors.New("creation targets a place from event_form")
		}
	case database.ActivityActionEventViewed:
		if targetType != database.ActivityTrackableTypeEvent || (source != database.ActivitySourcePlaceDetails && source != database.ActivitySourceYourEvents && source != database.ActivitySourceProfile) {
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
		if !((targetType == database.ActivityTrackableTypePlace && source == database.ActivitySourceEventForm) ||
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
	if activity.Action == database.ActivityActionInteractionPaused || activity.Action == database.ActivityActionInteractionClosed {
		allowed["reason"] = true
	}
	for key := range keys {
		if !allowed[key] {
			return fmt.Errorf("detail %s not allowed for action", key)
		}
	}
	return nil
}

// Discovery observations have strict context, but only place visits carry timers.
func (activity clientActivity) validateDiscovery(targetType database.ActivityTrackableType, source database.ActivitySource, step int32) error {
	var details struct {
		Sport     string       `json:"sport"`
		EmptyKind string       `json:"empty_kind,omitempty"`
		Referrer  *pgtype.UUID `json:"referrer_interaction_id,omitempty"`
		Elapsed   *int64       `json:"elapsed_ms,omitempty"`
		Active    *int64       `json:"active_ms,omitempty"`
	}
	decoder := json.NewDecoder(bytes.NewReader(activity.Details))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&details); err != nil {
		return errors.New("invalid discovery details")
	}
	if details.Sport != "all" && details.Sport != "football" && details.Sport != "cricket" && details.Sport != "padel" {
		return errors.New("sport must be all, football, cricket or padel")
	}
	allowed := map[string]bool{"sport": true}
	timed := false
	switch activity.Action {
	case database.ActivityActionSportFilterSelected:
		if activity.TrackableType != nil || source != database.ActivitySourceMap {
			return errors.New("sport filters are untargeted map actions")
		}
	case database.ActivityActionPlaceViewed:
		if targetType != database.ActivityTrackableTypePlace || source != database.ActivitySourceMap {
			return errors.New("place views target a place from map")
		}
		timed = true
		allowed["referrer_interaction_id"] = true
		if details.Referrer == nil || !details.Referrer.Valid || details.Referrer.Bytes == [16]byte{} || *details.Referrer == activity.InteractionID {
			return errors.New("place view needs a distinct referrer interaction ID")
		}
		if step != 1 {
			return errors.New("place view must start at step one")
		}
	case database.ActivityActionEmptyResultsViewed:
		allowed["empty_kind"] = true
		if source == database.ActivitySourceMap {
			if activity.TrackableType != nil || (details.EmptyKind != "no_events" && details.EmptyKind != "no_places") {
				return errors.New("invalid map empty result")
			}
		} else if source == database.ActivitySourcePlaceDetails {
			if targetType != database.ActivityTrackableTypePlace || details.EmptyKind != "no_events" || step < 2 {
				return errors.New("invalid place empty result")
			}
			timed = true
		} else {
			return errors.New("empty results must come from map or place_details")
		}
	}
	if timed {
		allowed["elapsed_ms"] = true
		allowed["active_ms"] = true
		if details.Elapsed == nil || details.Active == nil || *details.Active < 0 || *details.Elapsed < *details.Active || *details.Elapsed > 9007199254740991 {
			return errors.New("invalid discovery timing")
		}
		if activity.Action == database.ActivityActionPlaceViewed && (*details.Elapsed != 0 || *details.Active != 0) {
			return errors.New("place view starts with zero timing")
		}
	}
	var keys map[string]json.RawMessage
	json.Unmarshal(activity.Details, &keys)
	for key := range keys {
		if !allowed[key] {
			return fmt.Errorf("detail %s not allowed for discovery action", key)
		}
	}
	return nil
}
