package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"joinme/backend/internal/realtime"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/activities"
	"joinme/backend/internal/database"
	"joinme/backend/internal/events"
	"joinme/backend/internal/geography"
	"joinme/backend/internal/users"
	"joinme/backend/migrations"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required; see backend/README.md")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		log.Fatalf("connect database: %v", err)
	}
	defer pool.Close()
	if err = migrations.Apply(ctx, pool); err != nil {
		log.Fatalf("migrate database: %v", err)
	}
	geographyHandler := geography.Handler{Queries: database.New(pool)}
	demoUser := os.Getenv("DEMO_USER_ID")
	if demoUser == "" {
		demoUser = "20000000-0000-4000-8000-000000000001"
	}
	var demoUserID pgtype.UUID
	if err = demoUserID.Scan(demoUser); err != nil || !demoUserID.Valid {
		log.Fatal("DEMO_USER_ID must be a UUID")
	}
	eventHandler := events.Handler{Queries: database.New(pool), DemoUserID: demoUserID, Pool: pool}

	runtimeContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	live := realtime.NewServer(pool)
	live.Authorize = eventHandler.RealtimeAccess
	live.Snapshot = eventHandler.RealtimeSnapshot
	live.RelatedTargets = eventHandler.RealtimeRelatedTargets
	live.Viewer = func(ctx context.Context) (pgtype.UUID, error) {
		exists, err := database.New(pool).DemoUserExists(ctx, demoUserID)
		if err != nil {
			return pgtype.UUID{}, err
		}
		if !exists {
			return pgtype.UUID{}, fmt.Errorf("configured demo identity missing")
		}
		return demoUserID, nil
	}
	liveDone := make(chan struct{})
	go func() { defer close(liveDone); live.Run(runtimeContext) }()
	userHandler := users.Handler{Queries: database.New(pool), DemoUserID: demoUserID}
	activityHandler := activities.Handler{Queries: database.New(pool), DemoUserID: demoUserID}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /activities", activityHandler.Ingest)
	mux.HandleFunc("GET /ws", live.WebSocket)
	mux.HandleFunc("GET /realtime", live.LongPoll)
	mux.HandleFunc("GET /me", userHandler.Me)
	mux.HandleFunc("GET /me/activity", userHandler.Activity)
	mux.HandleFunc("PUT /me/event-goal", userHandler.EventGoal)
	mux.HandleFunc("PATCH /me", userHandler.Me)
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /areas/{id}", geographyHandler.GetArea)
	mux.HandleFunc("GET /places", geographyHandler.ListPlaces)
	mux.HandleFunc("GET /events", eventHandler.ListEvents)
	mux.HandleFunc("GET /me/events", eventHandler.ListUserEvents)
	mux.HandleFunc("PUT /events/{id}/cancellation", eventHandler.CancelEvent)
	mux.HandleFunc("POST /events", eventHandler.CreateEvent)
	mux.HandleFunc("GET /events/{id}", eventHandler.GetEvent)
	mux.HandleFunc("GET /events/{id}/signup-insights", eventHandler.SignupInsights)
	mux.HandleFunc("PATCH /events/{id}", eventHandler.UpdateEvent)
	mux.HandleFunc("GET /events/{id}/messages", eventHandler.Messages)
	mux.HandleFunc("POST /events/{id}/messages", eventHandler.Messages)
	mux.HandleFunc("PUT /events/{id}/participation", eventHandler.ChangeParticipation)
	mux.HandleFunc("DELETE /events/{id}/participation", eventHandler.ChangeParticipation)

	server := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 30 * time.Second, IdleTimeout: 60 * time.Second}
	log.Printf("API listening on :%s", port)
	go func() {
		<-runtimeContext.Done()
		shutdownContext, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		server.Shutdown(shutdownContext)
	}()
	if err = server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("HTTP server: %v", err)
		stop()
	}
	stop()
	<-liveDone
}
