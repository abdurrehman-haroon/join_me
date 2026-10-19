package events

import (
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/activities"
	"joinme/backend/internal/database"
	"joinme/backend/internal/geography"
)

type Handler struct {
	Queries    *database.Queries
	DemoUserID pgtype.UUID
	Pool       *pgxpool.Pool
}

func (handler Handler) CreateEvent(w http.ResponseWriter, request *http.Request) {
	tracking, trackingErr := activities.ReadRequestContext(request)
	if trackingErr != nil {
		http.Error(w, trackingErr.Error(), 400)
		return
	}
	var input struct {
		PlaceID  string             `json:"place_id"`
		Title    string             `json:"title"`
		Type     database.EventType `json:"type"`
		StartsAt time.Time          `json:"starts_at"`
		Capacity int32              `json:"capacity"`
	}
	request.Body = http.MaxBytesReader(w, request.Body, 16384)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		http.Error(w, "invalid event JSON", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "body must contain one event object", http.StatusBadRequest)
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 200 {
		http.Error(w, "title must contain 1 to 200 characters", http.StatusBadRequest)
		return
	}
	if input.Type != database.EventTypeFootball && input.Type != database.EventTypeCricket {
		http.Error(w, "type must be football or cricket", http.StatusBadRequest)
		return
	}
	if !tracking.ID.Valid && !input.StartsAt.After(time.Now()) {
		http.Error(w, "start time must be in the future", http.StatusBadRequest)
		return
	}
	if input.Capacity < 1 {
		http.Error(w, "capacity must be positive and includes the host", http.StatusBadRequest)
		return
	}
	var placeID pgtype.UUID
	if err := placeID.Scan(input.PlaceID); err != nil || !placeID.Valid {
		http.Error(w, "invalid place ID", http.StatusBadRequest)
		return
	}
	// Host and initial status are server-owned; sign-in replaces this demo identity later.
	if !handler.DemoUserID.Valid {
		http.Error(w, "demo user is not configured", http.StatusServiceUnavailable)
		return
	}
	statusID, err := handler.Queries.GetScheduledEventStatus(request.Context())
	if err != nil {
		log.Printf("get scheduled event status: %v", err)
		http.Error(w, "event creation is unavailable", http.StatusServiceUnavailable)
		return
	}
	if handler.Pool == nil {
		http.Error(w, "event creation unavailable", 503)
		return
	}
	transaction, err := handler.Pool.Begin(request.Context())
	if err != nil {
		http.Error(w, "could not create event", 500)
		return
	}
	defer transaction.Rollback(request.Context())
	queries := handler.Queries.WithTx(transaction)
	// Serialize matching request IDs, including concurrent first deliveries.
	body, _ := json.Marshal(input)
	requestHash := fmt.Sprintf("%x", sha256.Sum256(body))
	if tracking.ID.Valid {
		if err = queries.LockActivityRequest(request.Context(), tracking.ID.String()); err != nil {
			http.Error(w, "could not lock creation request", 500)
			return
		}
		saved, readErr := queries.GetActivity(request.Context(), tracking.ID)
		if readErr == nil {
			var details struct {
				RequestHash string `json:"request_hash"`
			}
			json.Unmarshal(saved.Details, &details)
			if saved.UserID != handler.DemoUserID || saved.Action != database.ActivityActionEventCreated || details.RequestHash != requestHash || saved.InteractionID != tracking.InteractionID || saved.SessionID != tracking.SessionID {
				http.Error(w, "creation request ID already used with different content", 409)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Location", "/events/"+saved.TrackableID.String())
			w.WriteHeader(201)
			json.NewEncoder(w).Encode(struct {
				ID pgtype.UUID `json:"id"`
			}{saved.TrackableID})
			return
		}
		if !errors.Is(readErr, pgx.ErrNoRows) {
			http.Error(w, "could not read creation request", 500)
			return
		}
	}
	if !input.StartsAt.After(time.Now()) {
		http.Error(w, "start time must be in the future", 400)
		return
	}
	event, err := queries.CreateEvent(request.Context(), database.CreateEventParams{
		HostID: handler.DemoUserID, PlaceID: placeID, StatusID: statusID, Title: input.Title,
		Type: input.Type, StartsAt: pgtype.Timestamptz{Time: input.StartsAt, Valid: true}, Capacity: input.Capacity,
	})
	if err != nil {
		var postgresError *pgconn.PgError
		if errors.As(err, &postgresError) && postgresError.Code == "23503" {
			switch postgresError.ConstraintName {
			case "events_place_id_fkey":
				http.Error(w, "place not found", http.StatusNotFound)
			case "pins_host_id_fkey":
				http.Error(w, "demo user is unavailable; load the demo data", http.StatusServiceUnavailable)
			default:
				http.Error(w, "event creation is unavailable", http.StatusServiceUnavailable)
			}
			return
		}
		log.Printf("create event: %v", err)
		http.Error(w, "could not create event", http.StatusInternalServerError)
		return
	}
	if err = activities.RecordOutcome(request.Context(), queries, handler.DemoUserID, event.ID,
		database.ActivityActionEventCreated, database.ActivitySourceEventForm, tracking, map[string]any{"request_hash": requestHash}); err == nil {
		err = recordEventUpdate(request.Context(), queries, event.ID)
	}
	if err == nil {
		err = transaction.Commit(request.Context())
	}
	if err != nil {
		log.Printf("commit event creation: %v", err)
		http.Error(w, "could not create event", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Location", "/events/"+event.ID.String())
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(struct {
		ID pgtype.UUID `json:"id"`
	}{ID: event.ID})
}

func (handler Handler) ListEvents(w http.ResponseWriter, request *http.Request) {
	bounds, err := geography.ParseBounds(request.URL.Query().Get("bbox"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	eventType := request.URL.Query().Get("type")
	if eventType != "" && eventType != string(database.EventTypeFootball) && eventType != string(database.EventTypeCricket) {
		http.Error(w, "type must be football or cricket", http.StatusBadRequest)
		return
	}
	events, err := handler.Queries.ListEventsInBounds(request.Context(), database.ListEventsInBoundsParams{
		West: bounds.West, South: bounds.South, East: bounds.East, North: bounds.North, EventFilter: eventType,
	})
	if err != nil {
		log.Printf("list events: %v", err)
		http.Error(w, "could not load events", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(events)
}

func (handler Handler) GetEvent(w http.ResponseWriter, request *http.Request) {
	var eventID pgtype.UUID
	if err := eventID.Scan(request.PathValue("id")); err != nil || !eventID.Valid {
		http.Error(w, "invalid event ID", http.StatusBadRequest)
		return
	}
	event, err := handler.Queries.GetEvent(request.Context(), database.GetEventParams{ID: eventID, ViewerID: handler.DemoUserID})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("get event: %v", err)
		http.Error(w, "could not load event", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(event)
}

// ChangeParticipation serializes all membership changes on the event row.
func (handler Handler) ChangeParticipation(w http.ResponseWriter, request *http.Request) {
	tracking, trackingErr := activities.ReadRequestContext(request)
	if trackingErr != nil {
		http.Error(w, trackingErr.Error(), 400)
		return
	}
	var eventID pgtype.UUID
	if err := eventID.Scan(request.PathValue("id")); err != nil || !eventID.Valid {
		http.Error(w, "invalid event ID", http.StatusBadRequest)
		return
	}
	if !handler.DemoUserID.Valid || handler.Pool == nil {
		http.Error(w, "demo user is not configured", http.StatusServiceUnavailable)
		return
	}
	exists, err := handler.Queries.DemoUserExists(request.Context(), handler.DemoUserID)
	if err != nil || !exists {
		if err != nil {
			log.Printf("get demo user: %v", err)
		}
		http.Error(w, "demo user is unavailable; load the demo data", http.StatusServiceUnavailable)
		return
	}
	transaction, err := handler.Pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		log.Printf("begin participation: %v", err)
		http.Error(w, "could not update participation", http.StatusInternalServerError)
		return
	}
	defer transaction.Rollback(request.Context())
	queries := handler.Queries.WithTx(transaction)
	event, err := queries.LockEventForParticipation(request.Context(), eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("lock event: %v", err)
		http.Error(w, "could not update participation", http.StatusInternalServerError)
		return
	}
	// Read the status after the row lock, using a fresh statement snapshot.
	statusSlug, err := queries.GetEventStatusSlug(request.Context(), event.StatusID)
	if err != nil {
		log.Printf("get participation status: %v", err)
		http.Error(w, "could not update participation", http.StatusInternalServerError)
		return
	}
	// The event lock serializes participation receipts with roster mutations.
	if tracking.ID.Valid {
		if err = queries.LockActivityRequest(request.Context(), tracking.ID.String()); err != nil {
			http.Error(w, "could not lock participation request", 500)
			return
		}
		saved, readErr := queries.GetActivity(request.Context(), tracking.ID)
		if readErr == nil {
			expected := database.ActivityActionParticipationJoined
			if request.Method == http.MethodDelete {
				expected = database.ActivityActionParticipationLeft
			}
			if saved.UserID != handler.DemoUserID || saved.TrackableID != eventID || saved.InteractionID != tracking.InteractionID || saved.SessionID != tracking.SessionID || (saved.Action != expected && !(request.Method == http.MethodPut && saved.Action == database.ActivityActionJoinRejected)) {
				http.Error(w, "participation request ID already used", 409)
				return
			}
			if saved.Action == database.ActivityActionJoinRejected {
				http.Error(w, "this join attempt was rejected; refresh before another attempt", 409)
			} else {
				w.WriteHeader(204)
			}
			return
		}
		if !errors.Is(readErr, pgx.ErrNoRows) {
			http.Error(w, "could not read participation request", 500)
			return
		}
	}
	var changed int64
	if request.Method == http.MethodDelete {
		if event.HostID == handler.DemoUserID {
			http.Error(w, "the host cannot leave their event", http.StatusConflict)
			return
		}
		changed, err = queries.LeaveEvent(request.Context(), database.LeaveEventParams{EventID: eventID, UserID: handler.DemoUserID})
	} else {
		// This query runs AFTER acquiring the lock, with a fresh READ COMMITTED snapshot.
		participation, readErr := queries.GetEventParticipation(request.Context(), database.GetEventParticipationParams{EventID: eventID, UserID: handler.DemoUserID})
		if readErr != nil {
			log.Printf("read participation: %v", readErr)
			http.Error(w, "could not update participation", http.StatusInternalServerError)
			return
		}
		if !participation.Joined {
			if statusSlug != "scheduled" || !event.StartsAt.Time.After(time.Now()) {
				if err = activities.RecordOutcome(request.Context(), queries, handler.DemoUserID, eventID,
					database.ActivityActionJoinRejected, database.ActivitySourceEventDetails, tracking, map[string]any{"reason": "closed"}); err != nil {
					http.Error(w, "could not record join outcome", 500)
					return
				}
				if err = transaction.Commit(request.Context()); err != nil {
					http.Error(w, "could not record join outcome", 500)
					return
				}
				http.Error(w, "this event is not open for joining", http.StatusConflict)
				return
			}
			if participation.ParticipantCount >= int64(event.Capacity) {
				if err = activities.RecordOutcome(request.Context(), queries, handler.DemoUserID, eventID,
					database.ActivityActionJoinRejected, database.ActivitySourceEventDetails, tracking, map[string]any{"reason": "full"}); err != nil {
					http.Error(w, "could not record join outcome", 500)
					return
				}
				if err = transaction.Commit(request.Context()); err != nil {
					http.Error(w, "could not record join outcome", 500)
					return
				}
				http.Error(w, "this event is full", http.StatusConflict)
				return
			}
			changed, err = queries.JoinEvent(request.Context(), database.JoinEventParams{EventID: eventID, UserID: handler.DemoUserID})
		}
	}
	if err != nil {
		log.Printf("change participation: %v", err)
		http.Error(w, "could not update participation", http.StatusInternalServerError)
		return
	}
	if changed > 0 {
		action := database.ActivityActionParticipationJoined
		if request.Method == http.MethodDelete {
			action = database.ActivityActionParticipationLeft
		}
		if err = activities.RecordOutcome(request.Context(), queries, handler.DemoUserID, eventID,
			action, database.ActivitySourceEventDetails, tracking, nil); err != nil {
			http.Error(w, "could not record participation", 500)
			return
		}
		if err = recordEventUpdate(request.Context(), queries, eventID); err != nil {
			log.Printf("record participation: %v", err)
			http.Error(w, "could not update participation", 500)
			return
		}
	}
	if err = transaction.Commit(request.Context()); err != nil {
		log.Printf("commit participation: %v", err)
		http.Error(w, "could not confirm participation; refresh the event", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) ListUserEvents(w http.ResponseWriter, request *http.Request) {
	section := request.URL.Query().Get("section")
	if section == "" {
		section = "upcoming"
	}
	if section != "upcoming" && section != "past" {
		http.Error(w, "section must be upcoming or past", http.StatusBadRequest)
		return
	}
	var offset int64
	if raw := request.URL.Query().Get("offset"); raw != "" {
		parsed, err := strconv.ParseInt(raw, 10, 32)
		if err != nil || parsed < 0 || parsed > 2147483597 {
			http.Error(w, "invalid offset", http.StatusBadRequest)
			return
		}
		offset = parsed
	}
	if !handler.DemoUserID.Valid {
		http.Error(w, "demo user is not configured", http.StatusServiceUnavailable)
		return
	}
	exists, err := handler.Queries.DemoUserExists(request.Context(), handler.DemoUserID)
	if err != nil || !exists {
		if err != nil {
			log.Printf("get demo user: %v", err)
		}
		http.Error(w, "demo user is unavailable; load the demo data", http.StatusServiceUnavailable)
		return
	}
	events, err := handler.Queries.ListUserEvents(request.Context(), database.ListUserEventsParams{
		UserID: handler.DemoUserID, Section: section, PageOffset: int32(offset),
	})
	if err != nil {
		log.Printf("list user events: %v", err)
		http.Error(w, "could not load your events", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(events)
}

func (handler Handler) CancelEvent(w http.ResponseWriter, request *http.Request) {
	var eventID pgtype.UUID
	if err := eventID.Scan(request.PathValue("id")); err != nil || !eventID.Valid {
		http.Error(w, "invalid event ID", http.StatusBadRequest)
		return
	}
	if !handler.DemoUserID.Valid || handler.Pool == nil {
		http.Error(w, "demo user is not configured", http.StatusServiceUnavailable)
		return
	}
	exists, err := handler.Queries.DemoUserExists(request.Context(), handler.DemoUserID)
	if err != nil || !exists {
		if err != nil {
			log.Printf("get demo user: %v", err)
		}
		http.Error(w, "demo user is unavailable; load the demo data", http.StatusServiceUnavailable)
		return
	}
	transaction, err := handler.Pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		log.Printf("begin cancellation: %v", err)
		http.Error(w, "could not cancel event", http.StatusInternalServerError)
		return
	}
	defer transaction.Rollback(request.Context())
	queries := handler.Queries.WithTx(transaction)
	// Share the participation lock so joins cannot race the change.
	event, err := queries.LockEventForParticipation(request.Context(), eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("lock cancellation event: %v", err)
		http.Error(w, "could not cancel event", http.StatusInternalServerError)
		return
	}
	if event.HostID != handler.DemoUserID {
		http.Error(w, "only the host can cancel this event", http.StatusForbidden)
		return
	}
	statusSlug, err := queries.GetEventStatusSlug(request.Context(), event.StatusID)
	if err != nil {
		log.Printf("get cancellation status: %v", err)
		http.Error(w, "could not cancel event", http.StatusInternalServerError)
		return
	}
	if statusSlug == "cancelled" {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if statusSlug != "scheduled" || !event.StartsAt.Time.After(time.Now()) {
		http.Error(w, "only upcoming scheduled events can be cancelled", http.StatusConflict)
		return
	}
	statusID, err := queries.GetCancelledEventStatus(request.Context())
	if err != nil {
		log.Printf("get cancelled event status: %v", err)
		http.Error(w, "event cancellation is unavailable", http.StatusServiceUnavailable)
		return
	}
	if err = queries.CancelEvent(request.Context(), database.CancelEventParams{ID: eventID, StatusID: statusID}); err != nil {
		log.Printf("cancel event: %v", err)
		http.Error(w, "could not cancel event", http.StatusInternalServerError)
		return
	}
	if err = activities.RecordOutcome(request.Context(), queries, handler.DemoUserID, eventID,
		database.ActivityActionEventCancelled, database.ActivitySourceEventDetails, activities.RequestContext{},
		map[string]any{"previous_status": statusSlug}); err != nil {
		log.Printf("record cancellation activity: %v", err)
		http.Error(w, "could not cancel event", http.StatusInternalServerError)
		return
	}
	if err = recordEventUpdate(request.Context(), queries, eventID); err != nil {
		log.Printf("record cancellation: %v", err)
		http.Error(w, "could not cancel event", 500)
		return
	}
	if err = transaction.Commit(request.Context()); err != nil {
		log.Printf("commit cancellation: %v", err)
		http.Error(w, "could not confirm cancellation; refresh the event", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) UpdateEvent(w http.ResponseWriter, request *http.Request) {
	var eventID pgtype.UUID
	if err := eventID.Scan(request.PathValue("id")); err != nil || !eventID.Valid {
		http.Error(w, "invalid event ID", http.StatusBadRequest)
		return
	}
	var input struct {
		Title    string    `json:"title"`
		StartsAt time.Time `json:"starts_at"`
		Capacity int32     `json:"capacity"`
	}
	request.Body = http.MaxBytesReader(w, request.Body, 16384)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil {
		http.Error(w, "invalid event JSON", http.StatusBadRequest)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "body must contain one event object", http.StatusBadRequest)
		return
	}
	input.Title = strings.TrimSpace(input.Title)
	if input.Title == "" || utf8.RuneCountInString(input.Title) > 200 {
		http.Error(w, "title must contain 1 to 200 characters", http.StatusBadRequest)
		return
	}
	if !input.StartsAt.After(time.Now()) {
		http.Error(w, "start time must be in the future", http.StatusBadRequest)
		return
	}
	if input.Capacity < 1 {
		http.Error(w, "capacity must be positive and includes the host", http.StatusBadRequest)
		return
	}
	if !handler.DemoUserID.Valid || handler.Pool == nil {
		http.Error(w, "demo user is not configured", http.StatusServiceUnavailable)
		return
	}
	exists, err := handler.Queries.DemoUserExists(request.Context(), handler.DemoUserID)
	if err != nil || !exists {
		if err != nil {
			log.Printf("get demo user: %v", err)
		}
		http.Error(w, "demo user is unavailable; load the demo data", http.StatusServiceUnavailable)
		return
	}
	transaction, err := handler.Pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		log.Printf("begin event edit: %v", err)
		http.Error(w, "could not update event", http.StatusInternalServerError)
		return
	}
	defer transaction.Rollback(request.Context())
	queries := handler.Queries.WithTx(transaction)
	// Share the participation lock so joins cannot race the change.
	event, err := queries.LockEventForParticipation(request.Context(), eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "event not found", http.StatusNotFound)
		return
	}
	if err != nil {
		log.Printf("lock event for editing: %v", err)
		http.Error(w, "could not update event", http.StatusInternalServerError)
		return
	}
	if event.HostID != handler.DemoUserID {
		http.Error(w, "only the host can edit this event", http.StatusForbidden)
		return
	}
	statusSlug, err := queries.GetEventStatusSlug(request.Context(), event.StatusID)
	if err != nil {
		log.Printf("get event edit status: %v", err)
		http.Error(w, "could not update event", http.StatusInternalServerError)
		return
	}
	if statusSlug != "scheduled" || !event.StartsAt.Time.After(time.Now()) {
		http.Error(w, "only upcoming scheduled events can be edited", http.StatusConflict)
		return
	}
	// Read membership after the shared row lock so concurrent joins are included.
	participation, err := queries.GetEventParticipation(request.Context(), database.GetEventParticipationParams{EventID: eventID, UserID: handler.DemoUserID})
	if err != nil {
		log.Printf("read edit participation: %v", err)
		http.Error(w, "could not update event", http.StatusInternalServerError)
		return
	}
	if int64(input.Capacity) < participation.ParticipantCount {
		http.Error(w, "capacity cannot be below the current participant count", http.StatusConflict)
		return
	}
	if !input.StartsAt.After(time.Now()) {
		http.Error(w, "start time must be in the future", http.StatusBadRequest)
		return
	}
	changed, err := queries.UpdateEvent(request.Context(), database.UpdateEventParams{ID: eventID, Title: input.Title, StartsAt: pgtype.Timestamptz{Time: input.StartsAt, Valid: true}, Capacity: input.Capacity})
	if err != nil {
		log.Printf("update event: %v", err)
		http.Error(w, "could not update event", http.StatusInternalServerError)
		return
	}
	if changed > 0 {
		changes := make(map[string]any)
		if event.Title != input.Title {
			changes["title"] = map[string]bool{"changed": true}
		}
		if event.Capacity != input.Capacity {
			changes["capacity"] = map[string]int32{"before": event.Capacity, "after": input.Capacity}
		}
		// PostgreSQL stores timestamps at microsecond precision, including in history.
		if !event.StartsAt.Time.Equal(input.StartsAt.Truncate(time.Microsecond)) {
			changes["starts_at"] = map[string]time.Time{"before": event.StartsAt.Time, "after": input.StartsAt.Truncate(time.Microsecond)}
		}
		if err = activities.RecordOutcome(request.Context(), queries, handler.DemoUserID, eventID,
			database.ActivityActionEventEdited, database.ActivitySourceEventForm, activities.RequestContext{},
			map[string]any{"changes": changes}); err != nil {
			log.Printf("record edit activity: %v", err)
			http.Error(w, "could not update event", http.StatusInternalServerError)
			return
		}
		if err = recordEventUpdate(request.Context(), queries, eventID); err != nil {
			log.Printf("record edit: %v", err)
			http.Error(w, "could not update event", 500)
			return
		}
	}
	if err = transaction.Commit(request.Context()); err != nil {
		log.Printf("commit event edit: %v", err)
		http.Error(w, "could not confirm event edit; refresh the event", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
