package users

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
)

type Handler struct {
	Queries    *database.Queries
	DemoUserID pgtype.UUID
}

// Me uses the same server-configured identity as events until sign-in is added.
func (handler Handler) Me(w http.ResponseWriter, request *http.Request) {
	var name string
	if request.Method == http.MethodPatch {
		var input struct {
			DisplayName string `json:"display_name"`
		}
		request.Body = http.MaxBytesReader(w, request.Body, 4096)
		decoder := json.NewDecoder(request.Body)
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&input); err != nil {
			http.Error(w, "invalid profile JSON", 400)
			return
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			http.Error(w, "body must contain one profile object", 400)
			return
		}
		name = strings.TrimSpace(input.DisplayName)
		if name == "" || utf8.RuneCountInString(name) > 100 || strings.ContainsAny(name, "\x00\r\n") {
			http.Error(w, "display name must contain 1 to 100 characters on one line", 400)
			return
		}
	}
	if !handler.DemoUserID.Valid {
		http.Error(w, "demo user is not configured", 503)
		return
	}
	var user database.User
	var err error
	if request.Method == http.MethodPatch {
		user, err = handler.Queries.UpdateUserName(request.Context(), database.UpdateUserNameParams{ID: handler.DemoUserID, DisplayName: name})
	} else {
		user, err = handler.Queries.GetUser(request.Context(), handler.DemoUserID)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		http.Error(w, "demo user is unavailable; load the demo data", 503)
		return
	}
	if err != nil {
		log.Printf("read/update profile: %v", err)
		http.Error(w, "could not load or save profile", 500)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(struct {
		ID          pgtype.UUID `json:"id"`
		DisplayName string      `json:"display_name"`
		CreatedAt   time.Time   `json:"created_at"`
		UpdatedAt   time.Time   `json:"updated_at"`
	}{user.ID, user.DisplayName, user.CreatedAt.Time, user.UpdatedAt.Time})
}
