package realtime

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

var (
	ErrForbidden     = errors.New("subscription forbidden")
	ErrNotFound      = errors.New("target not found")
	ErrInvalidTarget = errors.New("invalid target")
)

type Target struct {
	Type database.RealtimeTargetType
	ID   pgtype.UUID
}

type Frame struct {
	Type       string                      `json:"type"`
	ID         pgtype.UUID                 `json:"id,omitempty"`
	RequestID  string                      `json:"request_id,omitempty"`
	TargetType database.RealtimeTargetType `json:"target_type,omitempty"`
	TargetID   pgtype.UUID                 `json:"target_id,omitempty"`
	Sequence   string                      `json:"sequence,omitempty"`
	Payload    json.RawMessage             `json:"payload,omitempty"`
	Code       string                      `json:"code,omitempty"`
}

// Enqueue must use the caller's transaction. NOTIFY is delivered only after commit.
func Enqueue(ctx context.Context, queries *database.Queries, target Target, sequence int64, payload []byte) error {
	if err := queries.InsertRealtimeUpdate(ctx, database.InsertRealtimeUpdateParams{
		TargetType: target.Type, TargetID: target.ID, Sequence: sequence, Payload: payload,
	}); err != nil {
		return err
	}
	return queries.WakeRealtimeDispatcher(ctx)
}
