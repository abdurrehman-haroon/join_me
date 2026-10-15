package realtime

import (
	"context"
	"errors"
	"log"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

// LISTEN/NOTIFY fans publications to every API instance using the same database.
// Only UUIDs travel through NOTIFY; durable payloads remain in the outbox.
func (server *Server) Run(ctx context.Context) {
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); server.dispatchLoop(ctx) }()
	defer func() { server.disconnect(); <-workerDone }()
	delay := time.Second
	for ctx.Err() == nil {
		err := server.listenDatabase(ctx)
		server.disconnect()
		if ctx.Err() != nil {
			return
		}
		log.Printf("realtime database listener disconnected: %v", err)
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
		delay = min(delay*2, 30*time.Second)
	}
}

func (server *Server) listenDatabase(ctx context.Context) error {
	connection, err := pgx.ConnectConfig(ctx, server.Pool.Config().ConnConfig.Copy())
	if err != nil {
		return err
	}
	defer connection.Close(context.Background())
	if _, err = connection.Exec(ctx, "LISTEN realtime_ready; LISTEN realtime_published"); err != nil {
		return err
	}
	server.ready.Store(true)
	select {
	case server.wake <- struct{}{}:
	default:
	}
	queries := database.New(server.Pool)
	for {
		notification, err := connection.WaitForNotification(ctx)
		if err != nil {
			return err
		}
		if notification.Channel == "realtime_ready" {
			select {
			case server.wake <- struct{}{}:
			default:
			}
			continue
		}
		var id pgtype.UUID
		if id.Scan(notification.Payload) != nil || !id.Valid {
			continue
		}
		lookupCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
		update, err := queries.GetRealtimeUpdate(lookupCtx, id)
		cancel()
		if errors.Is(err, pgx.ErrNoRows) {
			continue
		} // A different test schema can share the notification channel.
		if err != nil {
			return err
		}
		target := Target{Type: update.TargetType, ID: update.TargetID}
		server.deliver(target, Frame{Type: "update", ID: update.ID, TargetType: target.Type, TargetID: target.ID, Sequence: strconv.FormatInt(update.Sequence, 10), Payload: update.Payload})
		if server.RelatedTargets != nil {
			for _, related := range server.RelatedTargets(target) {
				server.deliver(related, Frame{Type: "resync", TargetType: related.Type, TargetID: related.ID})
			}
		}
	}
}

func (server *Server) dispatchLoop(ctx context.Context) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-server.wake:
		case <-ticker.C:
		}
		// Bound each batch so shutdown and failed publications cannot starve recovery.
		for range 100 {
			updateCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
			found, err := server.publishNext(updateCtx)
			cancel()
			if err != nil {
				log.Printf("realtime outbox publish failed: %v", err)
				break
			}
			if !found {
				break
			}
		}
	}
}

func (server *Server) publishNext(ctx context.Context) (bool, error) {
	transaction, err := server.Pool.Begin(ctx)
	if err != nil {
		return false, err
	}
	defer transaction.Rollback(ctx)
	queries := database.New(transaction)
	update, err := queries.LockPendingRealtimeUpdate(ctx)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	// PostgreSQL delivers NOTIFY after commit. Marking published and notifying are atomic.
	err = queries.PublishRealtimeNotification(ctx, update.ID.String())
	if err == nil {
		err = queries.MarkRealtimePublished(ctx, update.ID)
	}
	if err == nil {
		err = transaction.Commit(ctx)
	}
	if err != nil {
		transaction.Rollback(ctx)
		retryCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 3*time.Second)
		defer cancel()
		if retryErr := database.New(server.Pool).RetryRealtimeUpdate(retryCtx, update.ID); retryErr != nil {
			log.Printf("realtime schedule retry failed: %v", retryErr)
		}
	}
	return true, err
}
