package events

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"joinme/backend/internal/realtime"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

type messageCursor struct {
	Sequence int64 `json:"sequence"`
}

type chatMessage struct {
	Sequence    string      `json:"sequence"`
	ID          pgtype.UUID `json:"id"`
	EventID     pgtype.UUID `json:"event_id"`
	UserID      pgtype.UUID `json:"user_id"`
	Body        string      `json:"body"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
	DisplayName string      `json:"display_name"`
	Cursor      string      `json:"cursor"`
}

func describeMessage(message database.Message, displayName string) chatMessage {
	cursor, _ := json.Marshal(messageCursor{Sequence: message.Sequence})
	return chatMessage{ID: message.ID, EventID: message.EventID, UserID: message.UserID, Body: message.Body,
		CreatedAt: message.CreatedAt.Time, UpdatedAt: message.UpdatedAt.Time, DisplayName: displayName,
		Sequence: strconv.FormatInt(message.Sequence, 10), Cursor: base64.RawURLEncoding.EncodeToString(cursor)}
}

// Messages shares the event lock with leaving and cancellation so access and writes
// are checked against the state that will actually be committed.
func (handler Handler) Messages(w http.ResponseWriter, request *http.Request) {
	var eventID pgtype.UUID
	if err := eventID.Scan(request.PathValue("id")); err != nil || !eventID.Valid {
		http.Error(w, "invalid event ID", 400)
		return
	}
	var input struct {
		ID   pgtype.UUID `json:"id"`
		Body string      `json:"body"`
	}
	params := database.ListMessagesParams{EventID: eventID}
	if request.Method == http.MethodPost {
		request.Body = http.MaxBytesReader(w, request.Body, 16384)
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			http.Error(w, "invalid message JSON", 400)
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			http.Error(w, "body must contain one message", 400)
			return
		}
		input.Body = strings.TrimSpace(input.Body)
		if !input.ID.Valid || input.Body == "" || utf8.RuneCountInString(input.Body) > 2000 || strings.ContainsRune(input.Body, 0) {
			http.Error(w, "provide a UUID and a message of 1 to 2000 characters", 400)
			return
		}
	} else {
		before, after := request.URL.Query().Get("before"), request.URL.Query().Get("after")
		if before != "" && after != "" {
			http.Error(w, "use before or after, not both", 400)
			return
		}
		raw := before
		if after != "" {
			raw = after
		}
		if raw != "" {
			var cursor messageCursor
			decoded, err := base64.RawURLEncoding.DecodeString(raw)
			if err != nil || json.Unmarshal(decoded, &cursor) != nil || cursor.Sequence <= 0 {
				http.Error(w, "invalid message cursor", 400)
				return
			}
			if before != "" {
				params.BeforeSequence = pgtype.Int8{Int64: cursor.Sequence, Valid: true}
			} else {
				params.AfterSequence = pgtype.Int8{Int64: cursor.Sequence, Valid: true}
			}
		}
	}
	if raw := request.URL.Query().Get("after_sequence"); raw != "" {
		sequence, parseErr := strconv.ParseInt(raw, 10, 64)
		if parseErr != nil || sequence < 0 || params.BeforeSequence.Valid || params.AfterSequence.Valid || request.Method != http.MethodGet {
			http.Error(w, "invalid after_sequence", 400)
			return
		}
		params.AfterSequence = pgtype.Int8{Int64: sequence, Valid: true}
	}
	if !handler.DemoUserID.Valid || handler.Pool == nil {
		http.Error(w, "demo user is not configured", 503)
		return
	}
	transaction, err := handler.Pool.BeginTx(request.Context(), pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		log.Printf("begin messages: %v", err)
		http.Error(w, "could not load chat", 500)
		return
	}
	defer transaction.Rollback(request.Context())
	queries := handler.Queries.WithTx(transaction)
	event, err := queries.LockEventForParticipation(request.Context(), eventID)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "event not found", 404)
		return
	}
	if err != nil {
		log.Printf("lock chat event: %v", err)
		http.Error(w, "could not load chat", 500)
		return
	}
	participation, err := queries.GetEventParticipation(request.Context(), database.GetEventParticipationParams{EventID: eventID, UserID: handler.DemoUserID})
	if err != nil {
		log.Printf("read chat membership: %v", err)
		http.Error(w, "could not load chat", 500)
		return
	}
	if !participation.Joined {
		http.Error(w, "join this event to access chat", 403)
		return
	}
	status, err := queries.GetEventStatusSlug(request.Context(), event.StatusID)
	if err != nil {
		log.Printf("read chat status: %v", err)
		http.Error(w, "could not load chat", 500)
		return
	}
	writable := status == "scheduled"
	if request.Method == http.MethodPost {
		existing, findErr := queries.FindMessage(request.Context(), input.ID)
		if findErr == nil {
			if existing.EventID != eventID || existing.UserID != handler.DemoUserID || existing.Body != input.Body {
				http.Error(w, "message ID already used for different content", 409)
				return
			}
			// A previously accepted message remains a successful retry after cancellation.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !errors.Is(findErr, pgx.ErrNoRows) {
			log.Printf("find message: %v", findErr)
			http.Error(w, "could not send message", 500)
			return
		}
		if !writable {
			http.Error(w, "chat is read-only for this event", 409)
			return
		}
		sequence, sequenceErr := queries.AdvanceRealtimeStream(request.Context(), database.AdvanceRealtimeStreamParams{TargetType: database.RealtimeTargetTypeEventMessages, TargetID: eventID})
		if sequenceErr != nil {
			log.Printf("allocate message sequence: %v", sequenceErr)
			http.Error(w, "could not send message", 500)
			return
		}
		_, err = queries.InsertMessage(request.Context(), database.InsertMessageParams{ID: input.ID, EventID: eventID, UserID: handler.DemoUserID, Body: input.Body, Sequence: sequence})
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "message ID already used", 409)
			return
		}
		if err != nil {
			log.Printf("insert message: %v", err)
			http.Error(w, "could not send message", 500)
			return
		}
		saved, err := queries.GetMessageWithSender(request.Context(), input.ID)
		if err == nil {
			var payload []byte
			payload, err = json.Marshal(describeMessage(saved.Message, saved.DisplayName))
			if err == nil {
				err = realtime.Enqueue(request.Context(), queries, realtime.Target{Type: database.RealtimeTargetTypeEventMessages, ID: eventID}, sequence, payload)
			}
		}
		if err != nil {
			log.Printf("record message update: %v", err)
			http.Error(w, "could not send message", 500)
			return
		}
		if err = transaction.Commit(request.Context()); err != nil {
			log.Printf("commit message: %v", err)
			http.Error(w, "could not confirm message; retry with the same ID", 500)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}
	rows, err := queries.ListMessages(request.Context(), params)
	if err != nil {
		log.Printf("list messages: %v", err)
		http.Error(w, "could not load messages", 500)
		return
	}
	hasMore := len(rows) > 50
	if hasMore {
		rows = rows[:50]
	}
	messages := make([]chatMessage, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, describeMessage(row.Message, row.DisplayName))
	}
	if !params.AfterSequence.Valid {
		for left, right := 0, len(messages)-1; left < right; left, right = left+1, right-1 {
			messages[left], messages[right] = messages[right], messages[left]
		}
	}
	sequence, err := queries.GetRealtimeSequence(request.Context(), database.GetRealtimeSequenceParams{TargetType: database.RealtimeTargetTypeEventMessages, TargetID: eventID})
	if err != nil {
		http.Error(w, "could not load chat state", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		Sequence string        `json:"sequence"`
		Messages []chatMessage `json:"messages"`
		HasMore  bool          `json:"has_more"`
		CanSend  bool          `json:"can_send"`
		ViewerID pgtype.UUID   `json:"viewer_id"`
	}{strconv.FormatInt(sequence, 10), messages, hasMore, writable, handler.DemoUserID})
}
