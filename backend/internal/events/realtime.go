package events

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
	"joinme/backend/internal/realtime"
)

// recordEventUpdate runs inside the same transaction and event lock as the change.
func recordEventUpdate(ctx context.Context, queries *database.Queries, eventID pgtype.UUID) error {
	sequence, err := queries.AdvanceRealtimeStream(ctx, database.AdvanceRealtimeStreamParams{
		TargetType: database.RealtimeTargetTypeEventDetails, TargetID: eventID,
	})
	if err != nil {
		return err
	}
	snapshot, err := queries.GetEvent(ctx, database.GetEventParams{ID: eventID})
	if err != nil {
		return err
	}
	var payload map[string]json.RawMessage
	if err = json.Unmarshal(snapshot, &payload); err != nil {
		return err
	}
	// Viewer flags belong to each connection, never to the shared outbox.
	delete(payload, "viewer")
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	return realtime.Enqueue(ctx, queries, realtime.Target{Type: database.RealtimeTargetTypeEventDetails, ID: eventID}, sequence, body)
}

func (handler Handler) RealtimeAccess(ctx context.Context, target realtime.Target, viewer pgtype.UUID) error {
	if target.Type != database.RealtimeTargetTypeEventDetails && target.Type != database.RealtimeTargetTypeEventMessages {
		return realtime.ErrInvalidTarget
	}
	access, err := handler.Queries.CheckRealtimeAccess(ctx, database.CheckRealtimeAccessParams{EventID: target.ID, UserID: viewer})
	if err != nil {
		return err
	}
	if !access.EventExists {
		return realtime.ErrNotFound
	}
	if target.Type == database.RealtimeTargetTypeEventMessages && !access.IsParticipant {
		return realtime.ErrForbidden
	}
	return nil
}

// Long polling uses authoritative state/history, so it also works after outbox cleanup.
func (handler Handler) RealtimeSnapshot(ctx context.Context, target realtime.Target, viewer pgtype.UUID, after int64) (realtime.Frame, error) {
	if err := handler.RealtimeAccess(ctx, target, viewer); err != nil {
		return realtime.Frame{}, err
	}
	if target.Type == database.RealtimeTargetTypeEventDetails {
		payload, err := handler.Queries.GetEvent(ctx, database.GetEventParams{ID: target.ID, ViewerID: viewer})
		if err != nil {
			return realtime.Frame{}, err
		}
		var snapshot struct {
			Sequence string `json:"sequence"`
		}
		if err = json.Unmarshal(payload, &snapshot); err != nil {
			return realtime.Frame{}, err
		}
		return realtime.Frame{Type: "snapshot", TargetType: target.Type, TargetID: target.ID, Sequence: snapshot.Sequence, Payload: payload}, nil
	}
	transaction, err := handler.Pool.Begin(ctx)
	if err != nil {
		return realtime.Frame{}, err
	}
	defer transaction.Rollback(ctx)
	queries := handler.Queries.WithTx(transaction)
	event, err := queries.LockEventForParticipation(ctx, target.ID)
	if err != nil {
		return realtime.Frame{}, err
	}
	membership, err := queries.GetEventParticipation(ctx, database.GetEventParticipationParams{EventID: target.ID, UserID: viewer})
	if err != nil {
		return realtime.Frame{}, err
	}
	if !membership.Joined {
		return realtime.Frame{}, realtime.ErrForbidden
	}
	status, err := queries.GetEventStatusSlug(ctx, event.StatusID)
	if err != nil {
		return realtime.Frame{}, err
	}
	rows, err := queries.ListMessagesBySequence(ctx, database.ListMessagesBySequenceParams{EventID: target.ID, AfterSequence: pgtype.Int8{Int64: after, Valid: true}})
	if err != nil {
		return realtime.Frame{}, err
	}
	messages := make([]chatMessage, 0, len(rows))
	hasMore := len(rows) > 50
	if hasMore {
		rows = rows[:50]
	}
	cursor := after
	for _, row := range rows {
		messages = append(messages, describeMessage(row.Message, row.DisplayName))
		cursor = row.Message.Sequence
	}
	sequence, err := queries.GetRealtimeSequence(ctx, database.GetRealtimeSequenceParams{TargetType: target.Type, TargetID: target.ID})
	if err != nil {
		return realtime.Frame{}, err
	}
	if hasMore {
		sequence = cursor
	}
	payload, err := json.Marshal(struct {
		Messages []chatMessage `json:"messages"`
		HasMore  bool          `json:"has_more"`
		CanSend  bool          `json:"can_send"`
		ViewerID pgtype.UUID   `json:"viewer_id"`
	}{messages, hasMore, status == "scheduled", viewer})
	if err != nil {
		return realtime.Frame{}, err
	}
	return realtime.Frame{Type: "snapshot", TargetType: target.Type, TargetID: target.ID, Sequence: strconv.FormatInt(sequence, 10), Payload: payload}, nil
}

// Roster and status changes also affect participant chat access and writability.
func (handler Handler) RealtimeRelatedTargets(target realtime.Target) []realtime.Target {
	if target.Type == database.RealtimeTargetTypeEventDetails {
		return []realtime.Target{{Type: database.RealtimeTargetTypeEventMessages, ID: target.ID}}
	}
	return nil
}
