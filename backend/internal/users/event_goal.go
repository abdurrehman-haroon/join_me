package users

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

func (handler Handler) EventGoal(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	var input struct {
		Target json.RawMessage `json:"event_goal_target"`
		Period json.RawMessage `json:"event_goal_period"`
	}
	request.Body = http.MaxBytesReader(w, request.Body, 1024)
	decoder := json.NewDecoder(request.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || len(input.Target) == 0 || len(input.Period) == 0 {
		http.Error(w, "provide event_goal_target and event_goal_period", 400)
		return
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		http.Error(w, "body must contain one goal object", 400)
		return
	}
	var target *int32
	var period *database.EventGoalPeriod
	if err := json.Unmarshal(input.Target, &target); err != nil {
		http.Error(w, "goal target must be a positive integer or null", 400)
		return
	}
	if err := json.Unmarshal(input.Period, &period); err != nil || (target == nil) != (period == nil) ||
		target != nil && (*target <= 0 || (*period != database.EventGoalPeriodWeekly && *period != database.EventGoalPeriodMonthly)) {
		http.Error(w, "set a positive target with weekly/monthly, or set both fields to null", 400)
		return
	}
	if !handler.DemoUserID.Valid {
		http.Error(w, "demo user is not configured", 503)
		return
	}
	params := database.UpdateUserEventGoalParams{ID: handler.DemoUserID}
	if target != nil {
		params.EventGoalTarget = pgtype.Int4{Int32: *target, Valid: true}
		params.EventGoalPeriod = database.NullEventGoalPeriod{EventGoalPeriod: *period, Valid: true}
	}
	saved, err := handler.Queries.UpdateUserEventGoal(request.Context(), params)
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "demo user is unavailable", 503)
		return
	}
	if err != nil {
		log.Printf("save event goal: %v", err)
		http.Error(w, "could not save your event goal", 500)
		return
	}
	var goal struct {
		Target *int32                    `json:"event_goal_target"`
		Period *database.EventGoalPeriod `json:"event_goal_period"`
	}
	if saved.EventGoalTarget.Valid {
		goal.Target = &saved.EventGoalTarget.Int32
		goal.Period = &saved.EventGoalPeriod.EventGoalPeriod
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(goal)
}
