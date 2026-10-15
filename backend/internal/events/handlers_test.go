package events

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
	"joinme/backend/migrations"
)

func TestInvalidEventCreation(t *testing.T) {
	future := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
	valid := fmt.Sprintf(`{"place_id":"00000000-0000-4000-8000-000000000003","title":"Football","type":"football","starts_at":%q,"capacity":10}`, future)
	for _, body := range []string{
		`{`, `null`, valid + `{}`, strings.Replace(valid, `"Football"`, `"  "`, 1),
		strings.Replace(valid, `"Football"`, `"`+strings.Repeat("a", 201)+`"`, 1),
		strings.Replace(valid, `"football"`, `"tennis"`, 1),
		strings.Replace(valid, future, "2000-01-01T00:00:00Z", 1),
		strings.Replace(valid, future, "2026-02-30T12:00:00Z", 1),
		strings.Replace(valid, future, "2030-01-01T12:00:00", 1),
		strings.Replace(valid, `"capacity":10`, `"capacity":0`, 1),
		strings.Replace(valid, `"capacity":10`, `"capacity":1.5`, 1),
		strings.Replace(valid, `"capacity":10`, `"capacity":2147483648`, 1),
		strings.Replace(valid, "00000000-0000-4000-8000-000000000003", "bad-id", 1),
		strings.Replace(valid, `"capacity":10`, `"capacity":10,"host_id":"someone"`, 1),
		strings.Replace(valid, `"capacity":10`, `"capacity":10,"status_id":"cancelled"`, 1),
		strings.Replace(valid, `"Football"`, `"`+strings.Repeat("a", 17000)+`"`, 1),
	} {
		response := httptest.NewRecorder()
		Handler{}.CreateEvent(response, httptest.NewRequest("POST", "/events", strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("invalid creation returned %d: %s", response.Code, response.Body.String())
		}
	}
}

func TestInvalidEventRequests(t *testing.T) {
	handler := Handler{}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /events", handler.ListEvents)
	mux.HandleFunc("GET /events/{id}", handler.GetEvent)
	mux.HandleFunc("PUT /events/{id}/participation", handler.ChangeParticipation)
	for _, path := range []string{"/events", "/events?bbox=NaN,0,1,1", "/events?bbox=0,0,1,1&type=tennis", "/events/bad-id"} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		if response.Code != 400 {
			t.Fatalf("%s: %d", path, response.Code)
		}
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("PUT", "/events/bad-id/participation", nil))
	if response.Code != 400 {
		t.Fatalf("bad participation ID: %d", response.Code)
	}
}

func TestEventBrowsing(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL for PostGIS integration checks")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("events_http_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE")
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	config.ConnConfig.RuntimeParams["search_path"] = schema + ",public"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err = migrations.Apply(ctx, pool); err != nil {
		t.Fatal(err)
	}
	seed, err := os.ReadFile("../../seeds/demo.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = pool.Exec(ctx, string(seed)); err != nil {
		t.Fatal(err)
	}
	handler := Handler{Queries: database.New(pool)}
	t.Run("host editing", func(t *testing.T) {
		var host, attendee, place, status pgtype.UUID
		host.Scan("20000000-0000-4000-8000-000000000001")
		attendee.Scan("20000000-0000-4000-8000-000000000002")
		place.Scan("00000000-0000-4000-8000-000000000003")
		queries := database.New(pool)
		status, err = queries.GetScheduledEventStatus(ctx)
		if err != nil {
			t.Fatal(err)
		}
		created, err := queries.CreateEvent(ctx, database.CreateEventParams{HostID: host, PlaceID: place, StatusID: status, Title: "Before editing", Type: database.EventTypeFootball, StartsAt: pgtype.Timestamptz{Time: time.Now().Add(3 * time.Hour), Valid: true}, Capacity: 3})
		if err != nil {
			t.Fatal(err)
		}
		defer func() {
			pool.Exec(ctx, "DELETE FROM event_participants WHERE event_id=$1", created.ID)
			pool.Exec(ctx, "DELETE FROM events WHERE id=$1", created.ID)
		}()
		call := func(user pgtype.UUID, method, body string) *httptest.ResponseRecorder {
			handler := Handler{Queries: queries, Pool: pool, DemoUserID: user}
			mux := http.NewServeMux()
			mux.HandleFunc("PATCH /events/{id}", handler.UpdateEvent)
			mux.HandleFunc("PUT /events/{id}/participation", handler.ChangeParticipation)
			response := httptest.NewRecorder()
			path := "/events/" + created.ID.String()
			if method == "PUT" {
				path += "/participation"
			}
			mux.ServeHTTP(response, httptest.NewRequest(method, path, strings.NewReader(body)))
			return response
		}
		future := time.Now().Add(4 * time.Hour).UTC().Format(time.RFC3339)
		body := fmt.Sprintf(`{"title":" Updated title ","starts_at":%q,"capacity":2}`, future)
		if response := call(attendee, "PATCH", body); response.Code != 403 {
			t.Fatalf("non-host: %d %s", response.Code, response.Body.String())
		}
		if response := call(host, "PATCH", body); response.Code != 204 {
			t.Fatalf("host edit: %d %s", response.Code, response.Body.String())
		}
		var title string
		var capacity int32
		var starts, createdAt, updatedAt time.Time
		if err := pool.QueryRow(ctx, "SELECT title,capacity,starts_at,created_at,updated_at FROM events WHERE id=$1", created.ID).Scan(&title, &capacity, &starts, &createdAt, &updatedAt); err != nil {
			t.Fatal(err)
		}
		if title != "Updated title" || capacity != 2 || starts.UTC().Format(time.RFC3339) != future || !createdAt.Equal(created.CreatedAt.Time) || !updatedAt.After(created.UpdatedAt.Time) {
			t.Fatal("edited fields or timestamps incorrect")
		}
		for _, invalid := range []string{`null`, `{}`, body + `{}`, strings.Replace(body, `"capacity":2`, `"capacity":0`, 1), strings.Replace(body, `"capacity":2`, `"capacity":2,"type":"cricket"`, 1), strings.Replace(body, future, "2000-01-01T00:00:00Z", 1)} {
			if response := call(host, "PATCH", invalid); response.Code != 400 {
				t.Fatalf("invalid edit: %d", response.Code)
			}
		}
		// Either the capacity reduction wins and joining fails, or joining wins and editing fails.
		results := make(chan int, 2)
		go func() { results <- call(host, "PATCH", strings.Replace(body, `"capacity":2`, `"capacity":1`, 1)).Code }()
		go func() { results <- call(attendee, "PUT", "").Code }()
		first, second := <-results, <-results
		if !((first == 204 && second == 409) || (first == 409 && second == 204)) {
			t.Fatalf("edit/join race: %d %d", first, second)
		}
		var count int64
		if err := pool.QueryRow(ctx, "SELECT capacity,(SELECT count(*) FROM event_participants WHERE event_id=events.id) FROM events WHERE id=$1", created.ID).Scan(&capacity, &count); err != nil || count > int64(capacity) {
			t.Fatalf("overbooking: %d/%d %v", count, capacity, err)
		}
		pool.Exec(ctx, "UPDATE events SET starts_at=now()-interval '1 hour' WHERE id=$1", created.ID)
		if response := call(host, "PATCH", body); response.Code != 409 {
			t.Fatalf("elapsed edit: %d", response.Code)
		}
		pool.Exec(ctx, "UPDATE events SET starts_at=now()+interval '1 hour', status_id=(SELECT id FROM status WHERE slug='cancelled') WHERE id=$1", created.ID)
		if response := call(host, "PATCH", body); response.Code != 409 {
			t.Fatalf("cancelled edit: %d", response.Code)
		}
	})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /events", handler.ListEvents)
	mux.HandleFunc("GET /events/{id}", handler.GetEvent)
	for _, check := range []struct {
		query     string
		count     int
		eventType string
	}{
		{"bbox=74.40,31.46,74.42,31.48", 3, ""},
		{"bbox=74.40,31.46,74.42,31.48&type=football", 1, "football"},
		{"bbox=74.40,31.46,74.42,31.48&type=cricket", 2, "cricket"},
		{"bbox=0,0,1,1", 0, ""},
	} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", "/events?"+check.query, nil))
		var list struct {
			Events []struct {
				ID       string
				Type     string
				StartsAt time.Time `json:"starts_at"`
				Full     bool      `json:"is_full"`
				Spots    int       `json:"available_spots"`
			}
			PlaceCounts map[string]int `json:"place_counts"`
			Truncated   bool
		}
		if err = json.Unmarshal(response.Body.Bytes(), &list); err != nil || response.Code != 200 || len(list.Events) != check.count || list.Truncated {
			t.Fatalf("%s: %d %s (%v)", check.query, response.Code, response.Body.String(), err)
		}
		count := 0
		for _, amount := range list.PlaceCounts {
			count += amount
		}
		if count != check.count {
			t.Fatalf("place counts: %v", list.PlaceCounts)
		}
		for index, event := range list.Events {
			if check.eventType != "" && event.Type != check.eventType {
				t.Fatal("type filter ignored")
			}
			if index > 0 && event.StartsAt.Before(list.Events[index-1].StartsAt) {
				t.Fatal("events out of order")
			}
			if event.ID == "30000000-0000-4000-8000-000000000002" && (!event.Full || event.Spots != 0) {
				t.Fatal("full event capacity incorrect")
			}
		}
	}
	for _, check := range []struct {
		id, slug           string
		code, participants int
	}{
		{"30000000-0000-4000-8000-000000000001", "scheduled", 200, 3},
		{"30000000-0000-4000-8000-000000000002", "scheduled", 200, 4},
		{"30000000-0000-4000-8000-000000000003", "cancelled", 200, 1},
		{"30000000-0000-4000-8000-000000000004", "completed", 200, 2},
		{"ffffffff-ffff-4fff-8fff-ffffffffffff", "", 404, 0},
	} {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", "/events/"+check.id, nil))
		if response.Code != check.code {
			t.Fatalf("detail %s: %d %s", check.id, response.Code, response.Body.String())
		}
		if check.code != 200 {
			continue
		}
		var detail struct {
			Status struct{ Slug string }
			Host   struct {
				Name string `json:"display_name"`
			}
			Participants []json.RawMessage
			Count        int `json:"participant_count"`
		}
		if err = json.Unmarshal(response.Body.Bytes(), &detail); err != nil || detail.Status.Slug != check.slug || detail.Count != check.participants || len(detail.Participants) != check.participants || detail.Host.Name == "" {
			t.Fatalf("detail: %s (%v)", response.Body.String(), err)
		}
	}
	// An elapsed scheduled event must disappear without a status mutation.
	if _, err = pool.Exec(ctx, `UPDATE events SET starts_at=statement_timestamp()-interval '1 minute' WHERE id='30000000-0000-4000-8000-000000000001'`); err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/events?bbox=74.40,31.46,74.42,31.48&type=football", nil))
	var list struct {
		Events      []json.RawMessage
		Truncated   bool
		PlaceCounts map[string]int `json:"place_counts"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &list); err != nil || len(list.Events) != 0 {
		t.Fatalf("elapsed event returned: %s", response.Body.String())
	}
	_, err = pool.Exec(ctx, `INSERT INTO events(host_id,place_id,status_id,title,type,starts_at,capacity)
        SELECT '20000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001','Extra '||number,'football',statement_timestamp()+interval '1 hour',10 FROM generate_series(1,1001) AS number`)
	if err != nil {
		t.Fatal(err)
	}
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, httptest.NewRequest("GET", "/events?bbox=74.40,31.46,74.42,31.48&type=football", nil))
	if err = json.Unmarshal(response.Body.Bytes(), &list); err != nil || len(list.Events) != 1000 || !list.Truncated || list.PlaceCounts["00000000-0000-4000-8000-000000000003"] != 1001 {
		t.Fatalf("bounded results and exact marker counts: %d %v (%v)", len(list.Events), list.PlaceCounts, err)
	}

	t.Run("participation and simultaneous last spot", func(t *testing.T) {
		var hostID, firstID, secondID, placeID, statusID pgtype.UUID
		for _, entry := range []struct {
			target *pgtype.UUID
			value  string
		}{
			{&hostID, "20000000-0000-4000-8000-000000000001"},
			{&firstID, "20000000-0000-4000-8000-000000000002"},
			{&secondID, "20000000-0000-4000-8000-000000000006"},
			{&placeID, "00000000-0000-4000-8000-000000000003"},
			{&statusID, "10000000-0000-4000-8000-000000000001"},
		} {
			if err := entry.target.Scan(entry.value); err != nil {
				t.Fatal(err)
			}
		}
		created, err := database.New(pool).CreateEvent(ctx, database.CreateEventParams{
			HostID: hostID, PlaceID: placeID, StatusID: statusID, Title: "Last spot", Type: database.EventTypeFootball,
			StartsAt: pgtype.Timestamptz{Time: time.Now().Add(time.Hour), Valid: true}, Capacity: 2,
		})
		if err != nil {
			t.Fatal(err)
		}
		call := func(userID pgtype.UUID, method, eventID string) *httptest.ResponseRecorder {
			handler := Handler{Queries: database.New(pool), Pool: pool, DemoUserID: userID}
			mux := http.NewServeMux()
			mux.HandleFunc("PUT /events/{id}/participation", handler.ChangeParticipation)
			mux.HandleFunc("DELETE /events/{id}/participation", handler.ChangeParticipation)
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, httptest.NewRequest(method, "/events/"+eventID+"/participation", nil))
			return response
		}
		// Separate users race for one remaining place, released by the same barrier.
		type attempt struct {
			user pgtype.UUID
			code int
		}
		start := make(chan struct{})
		results := make(chan attempt, 2)
		for _, user := range []pgtype.UUID{firstID, secondID} {
			go func(user pgtype.UUID) { <-start; results <- attempt{user, call(user, "PUT", created.ID.String()).Code} }(user)
		}
		close(start)
		var winner, loser pgtype.UUID
		successes, conflicts := 0, 0
		for range 2 {
			result := <-results
			switch result.code {
			case 204:
				successes++
				winner = result.user
			case 409:
				conflicts++
				loser = result.user
			default:
				t.Fatalf("unexpected concurrent status %d", result.code)
			}
		}
		if successes != 1 || conflicts != 1 {
			t.Fatalf("last spot: successes=%d conflicts=%d", successes, conflicts)
		}
		var count int
		if err = pool.QueryRow(ctx, "SELECT count(*) FROM event_participants WHERE event_id=$1", created.ID).Scan(&count); err != nil || count != 2 {
			t.Fatalf("overbooked: %d (%v)", count, err)
		}
		for _, check := range []struct {
			user   pgtype.UUID
			method string
			code   int
		}{
			{winner, "PUT", 204}, // Already joined, even when full.
			{hostID, "DELETE", 409},
			{winner, "DELETE", 204},
			{winner, "DELETE", 204}, // Already absent.
			{loser, "PUT", 204},     // Leaving freed the final spot.
		} {
			response := call(check.user, check.method, created.ID.String())
			if response.Code != check.code {
				t.Fatalf("%s: %d %s", check.method, response.Code, response.Body.String())
			}
		}
		var payload struct {
			Viewer struct {
				ID     string
				Host   bool `json:"is_host"`
				Joined bool `json:"is_participant"`
			}
		}
		detail, err := database.New(pool).GetEvent(ctx, database.GetEventParams{ID: created.ID, ViewerID: loser})
		if err != nil || json.Unmarshal(detail, &payload) != nil || payload.Viewer.ID != loser.String() || !payload.Viewer.Joined || payload.Viewer.Host {
			t.Fatalf("viewer participation: %s (%v)", detail, err)
		}
		for _, eventID := range []string{
			"30000000-0000-4000-8000-000000000002", // Full; Demo Ali is not a member.
			"30000000-0000-4000-8000-000000000003", // Cancelled.
			"30000000-0000-4000-8000-000000000004", // Completed.
			"30000000-0000-4000-8000-000000000001", // Elapsed by earlier browsing check.
		} {
			response := call(hostID, "PUT", eventID)
			// Demo Ali hosts the elapsed event and joined the completed demo: idempotent retries succeed.
			expected := 409
			if eventID == "30000000-0000-4000-8000-000000000001" || eventID == "30000000-0000-4000-8000-000000000004" {
				expected = 204
			}
			if response.Code != expected {
				t.Fatalf("closed/full event: %d %s", response.Code, response.Body.String())
			}
		}
		// A new attendee cannot join an elapsed scheduled event or a completed event.
		for _, eventID := range []string{"30000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000004"} {
			if response := call(firstID, "PUT", eventID); response.Code != 409 {
				t.Fatalf("closed event: %d", response.Code)
			}
		}
		if response := call(hostID, "PUT", "ffffffff-ffff-4fff-8fff-ffffffffffff"); response.Code != 404 {
			t.Fatalf("missing event: %d", response.Code)
		}
		var missingID pgtype.UUID
		if err = missingID.Scan("ffffffff-ffff-4fff-8fff-ffffffffffff"); err != nil {
			t.Fatal(err)
		}
		if response := call(missingID, "PUT", created.ID.String()); response.Code != 503 {
			t.Fatalf("missing demo user: %d", response.Code)
		}
	})

	t.Run("your events pagination and host cancellation", func(t *testing.T) {
		var hostID, attendeeID, strangerID, placeID, statusID pgtype.UUID
		hostID.Scan("20000000-0000-4000-8000-000000000001")
		attendeeID.Scan("20000000-0000-4000-8000-000000000002")
		strangerID.Scan("20000000-0000-4000-8000-000000000006")
		placeID.Scan("00000000-0000-4000-8000-000000000003")
		statusID.Scan("10000000-0000-4000-8000-000000000001")
		queries := database.New(pool)
		created, err := queries.CreateEvent(ctx, database.CreateEventParams{HostID: hostID, PlaceID: placeID, StatusID: statusID, Title: "Cancellation test", Type: database.EventTypeFootball, StartsAt: pgtype.Timestamptz{Time: time.Now().Add(2 * time.Hour), Valid: true}, Capacity: 3})
		if err != nil {
			t.Fatal(err)
		}
		if _, err = queries.JoinEvent(ctx, database.JoinEventParams{EventID: created.ID, UserID: attendeeID}); err != nil {
			t.Fatal(err)
		}
		call := func(user pgtype.UUID, method, path string) *httptest.ResponseRecorder {
			h := Handler{Queries: queries, Pool: pool, DemoUserID: user}
			router := http.NewServeMux()
			router.HandleFunc("GET /me/events", h.ListUserEvents)
			router.HandleFunc("GET /events", h.ListEvents)
			router.HandleFunc("PUT /events/{id}/cancellation", h.CancelEvent)
			router.HandleFunc("PUT /events/{id}/participation", h.ChangeParticipation)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, httptest.NewRequest(method, path, nil))
			return response
		}
		type page struct {
			Events []struct {
				ID       string
				StartsAt time.Time `json:"starts_at"`
			}
			Next *int `json:"next_offset"`
		}
		load := func(user pgtype.UUID, section string, offset int) page {
			t.Helper()
			response := call(user, "GET", fmt.Sprintf("/me/events?section=%s&offset=%d", section, offset))
			var result page
			if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &result) != nil {
				t.Fatalf("list: %d %s", response.Code, response.Body.String())
			}
			return result
		}
		first := load(hostID, "upcoming", 0)
		second := load(hostID, "upcoming", 50)
		if len(first.Events) != 50 || first.Next == nil || *first.Next != 50 || len(second.Events) != 50 {
			t.Fatal("pagination failed")
		}
		seen := map[string]bool{}
		for _, event := range first.Events {
			seen[event.ID] = true
		}
		for _, event := range second.Events {
			if seen[event.ID] {
				t.Fatal("duplicate between pages")
			}
		}
		for _, user := range []pgtype.UUID{hostID, attendeeID, strangerID} {
			upcoming := load(user, "upcoming", 0)
			for _, event := range upcoming.Events {
				var belongs bool
				if err := pool.QueryRow(ctx, "SELECT host_id=$2 OR EXISTS(SELECT 1 FROM event_participants WHERE event_id=$1 AND user_id=$2) FROM events WHERE id=$1", event.ID, user).Scan(&belongs); err != nil || !belongs {
					t.Fatal("unrelated event leaked")
				}
			}
		}
		contains := func(events page, id string) bool {
			for _, event := range events.Events {
				if event.ID == id {
					return true
				}
			}
			return false
		}
		if !contains(load(attendeeID, "upcoming", 0), created.ID.String()) {
			t.Fatal("joined event missing")
		}
		if !contains(load(hostID, "past", 0), "30000000-0000-4000-8000-000000000004") {
			t.Fatal("completed participation missing")
		}
		path := "/events/" + created.ID.String() + "/cancellation"
		if response := call(attendeeID, "PUT", path); response.Code != 403 {
			t.Fatalf("non-host cancellation %d", response.Code)
		}
		results := make(chan int, 2)
		go func() { results <- call(hostID, "PUT", path).Code }()
		go func() { results <- call(strangerID, "PUT", "/events/"+created.ID.String()+"/participation").Code }()
		a, b := <-results, <-results
		if !((a == 204 && (b == 204 || b == 409)) || (b == 204 && a == 409)) {
			t.Fatalf("cancel/join race: %d %d", a, b)
		}
		if response := call(hostID, "PUT", path); response.Code != 204 {
			t.Fatalf("repeat cancellation %d", response.Code)
		}
		var slug string
		var count int
		var createdAt, updatedAt time.Time
		if err := pool.QueryRow(ctx, "SELECT status.slug, events.created_at, events.updated_at, (SELECT count(*) FROM event_participants WHERE event_id=events.id) FROM events JOIN status ON status.id=events.status_id WHERE events.id=$1", created.ID).Scan(&slug, &createdAt, &updatedAt, &count); err != nil || slug != "cancelled" || count < 2 || !updatedAt.After(createdAt) {
			t.Fatalf("cancellation lost roster or timestamps: %s %d %v", slug, count, err)
		}
		if contains(load(attendeeID, "upcoming", 0), created.ID.String()) || !contains(load(attendeeID, "past", 0), created.ID.String()) {
			t.Fatal("cancelled event did not move to Past")
		}
		if response := call(attendeeID, "PUT", "/events/"+created.ID.String()+"/participation"); response.Code != 204 {
			t.Fatal("existing participation not preserved")
		}
		var newUser pgtype.UUID
		newUser.Scan("20000000-0000-4000-8000-000000000005")
		if response := call(newUser, "PUT", "/events/"+created.ID.String()+"/participation"); response.Code != 409 {
			t.Fatal("cancelled event accepted new join")
		}
		for _, check := range []struct {
			user         pgtype.UUID
			method, path string
			code         int
		}{
			{hostID, "PUT", "/events/bad/cancellation", 400},
			{hostID, "PUT", "/events/ffffffff-ffff-4fff-8fff-ffffffffffff/cancellation", 404},
			{hostID, "PUT", "/events/30000000-0000-4000-8000-000000000001/cancellation", 409},
			{hostID, "GET", "/me/events?section=invalid", 400},
			{hostID, "GET", "/me/events?offset=-1", 400},
			{hostID, "GET", "/me/events?offset=2147483647", 400},
			{pgtype.UUID{}, "GET", "/me/events", 503},
			{pgtype.UUID{}, "PUT", path, 503},
		} {
			if response := call(check.user, check.method, check.path); response.Code != check.code {
				t.Fatalf("%s: %d want %d", check.path, response.Code, check.code)
			}
		}
	})

	t.Run("create scheduled event as demo host", func(t *testing.T) {
		var demoID pgtype.UUID
		if err := demoID.Scan("20000000-0000-4000-8000-000000000001"); err != nil {
			t.Fatal(err)
		}
		creator := Handler{Queries: database.New(pool), Pool: pool, DemoUserID: demoID}
		body := fmt.Sprintf(`{"place_id":"00000000-0000-4000-8000-000000000003","title":"  Test creation  ","type":"cricket","starts_at":%q,"capacity":1}`, time.Now().Add(2*time.Hour).Format(time.RFC3339))
		response := httptest.NewRecorder()
		creator.CreateEvent(response, httptest.NewRequest("POST", "/events", strings.NewReader(body)))
		var created struct{ ID string }
		if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil || response.Code != 201 || created.ID == "" || response.Header().Get("Location") != "/events/"+created.ID {
			t.Fatalf("create: %d %s (%v)", response.Code, response.Body.String(), err)
		}
		var title, slug, host string
		var participants int
		var createdAt, updatedAt time.Time
		err := pool.QueryRow(ctx, `SELECT events.title,status.slug,events.host_id,
            (SELECT count(*) FROM event_participants WHERE event_id=events.id),events.created_at,events.updated_at
            FROM events JOIN status ON status.id=events.status_id WHERE events.id=$1`, created.ID).
			Scan(&title, &slug, &host, &participants, &createdAt, &updatedAt)
		if err != nil || title != "Test creation" || slug != "scheduled" || host != demoID.String() || participants != 1 || !createdAt.Equal(updatedAt) {
			t.Fatalf("created event invariants: %s %s %s %d (%v)", title, slug, host, participants, err)
		}
		var before int
		if err = pool.QueryRow(ctx, "SELECT count(*) FROM events").Scan(&before); err != nil {
			t.Fatal(err)
		}
		response = httptest.NewRecorder()
		creator.CreateEvent(response, httptest.NewRequest("POST", "/events", strings.NewReader(strings.Replace(body, "00000000-0000-4000-8000-000000000003", "ffffffff-ffff-4fff-8fff-ffffffffffff", 1))))
		if response.Code != 404 {
			t.Fatalf("missing place: %d %s", response.Code, response.Body.String())
		}
		var missingID pgtype.UUID
		if err = missingID.Scan("ffffffff-ffff-4fff-8fff-ffffffffffff"); err != nil {
			t.Fatal(err)
		}
		creator.DemoUserID = missingID
		response = httptest.NewRecorder()
		creator.CreateEvent(response, httptest.NewRequest("POST", "/events", strings.NewReader(body)))
		if response.Code != 503 {
			t.Fatalf("missing demo host: %d %s", response.Code, response.Body.String())
		}
		creator.DemoUserID = demoID
		if _, err = pool.Exec(ctx, `UPDATE status SET slug='temporarily-unavailable' WHERE slug='scheduled'`); err != nil {
			t.Fatal(err)
		}
		response = httptest.NewRecorder()
		creator.CreateEvent(response, httptest.NewRequest("POST", "/events", strings.NewReader(body)))
		if response.Code != 503 {
			t.Fatalf("missing scheduled status: %d", response.Code)
		}
		var after int
		if err = pool.QueryRow(ctx, "SELECT count(*) FROM events").Scan(&after); err != nil || after != before {
			t.Fatalf("failed creation left partial events: %d to %d (%v)", before, after, err)
		}
	})
}
