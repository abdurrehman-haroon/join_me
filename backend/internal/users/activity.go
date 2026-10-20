package users

import (
	"errors"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

// Activity always uses the server identity; callers cannot select another user.
func (handler Handler) Activity(w http.ResponseWriter, request *http.Request) {
	query := request.URL.Query()
	for key, values := range query {
		if (key != "period" && key != "timezone" && key != "offset") || len(values) != 1 {
			http.Error(w, "unsupported or repeated parameter", 400)
			return
		}
	}
	period := query.Get("period")
	if period == "" {
		period = "month"
	}
	if period != "month" && period != "all" {
		http.Error(w, "period must be month or all", 400)
		return
	}
	timezone := query.Get("timezone")
	if timezone == "" {
		timezone = "UTC"
	}
	location, err := time.LoadLocation(timezone)
	if err != nil || timezone == "Local" {
		http.Error(w, "timezone must be an IANA timezone", 400)
		return
	}
	offset := 0
	if query.Has("offset") {
		offset, err = strconv.Atoi(query.Get("offset"))
		if err != nil || offset < 0 || offset > 2147483627 {
			http.Error(w, "invalid offset", 400)
			return
		}
	}
	if !handler.DemoUserID.Valid {
		http.Error(w, "demo user is not configured", 503)
		return
	}
	if _, err = handler.Queries.GetUser(request.Context(), handler.DemoUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			http.Error(w, "demo user is unavailable", 503)
		} else {
			log.Printf("read activity user: %v", err)
			http.Error(w, "could not load your activity", 500)
		}
		return
	}
	until := time.Now().In(location)
	since := time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC)
	if period == "month" {
		since = time.Date(until.Year(), until.Month(), 1, 0, 0, 0, 0, location)
	}
	activity, err := handler.Queries.GetUserActivity(request.Context(), database.GetUserActivityParams{
		UserID:     handler.DemoUserID,
		Since:      pgtype.Timestamptz{Time: since, Valid: true},
		Until:      pgtype.Timestamptz{Time: until, Valid: true},
		PageOffset: int32(offset),
		Timezone:   timezone,
	})
	if err != nil {
		log.Printf("read user activity: %v", err)
		http.Error(w, "could not load your activity", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(activity)
}
