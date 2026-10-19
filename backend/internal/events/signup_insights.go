package events

import (
	"errors"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

// SignupInsights is private to the server-configured host, never part of shared realtime payloads.
func (handler Handler) SignupInsights(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var eventID pgtype.UUID
	if err := eventID.Scan(request.PathValue("id")); err != nil || !eventID.Valid {
		http.Error(w, "invalid event ID", 400)
		return
	}
	if !handler.DemoUserID.Valid {
		http.Error(w, "demo user is not configured", 503)
		return
	}
	insights, err := handler.Queries.GetHostSignupInsights(request.Context(), database.GetHostSignupInsightsParams{
		EventID: eventID, UserID: handler.DemoUserID,
	})
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "event not found", 404)
		return
	}
	if err != nil {
		log.Printf("get signup insights: %v", err)
		http.Error(w, "could not load signup insights", 500)
		return
	}
	if len(insights) == 0 {
		http.Error(w, "only the host can view signup insights", 403)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(insights)
}
