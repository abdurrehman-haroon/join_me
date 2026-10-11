package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
	"joinme/backend/internal/events"
	"joinme/backend/internal/geography"
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

	mux := http.NewServeMux()
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
	mux.HandleFunc("GET /events/{id}/messages", eventHandler.Messages)
	mux.HandleFunc("POST /events/{id}/messages", eventHandler.Messages)
	mux.HandleFunc("PUT /events/{id}/participation", eventHandler.ChangeParticipation)
	mux.HandleFunc("DELETE /events/{id}/participation", eventHandler.ChangeParticipation)

	server := &http.Server{Addr: ":" + port, Handler: mux, ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 15 * time.Second}
	log.Printf("API listening on :%s", port)
	log.Fatal(server.ListenAndServe())
}
