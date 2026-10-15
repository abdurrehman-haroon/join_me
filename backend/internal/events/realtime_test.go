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

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
	"joinme/backend/internal/realtime"
	"joinme/backend/migrations"
)

func TestRealtimeDeliveryAndRecovery(t *testing.T) {
	databaseURL := os.Getenv("TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set TEST_DATABASE_URL")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("realtime_test_%d", time.Now().UnixNano())
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
	var host, player pgtype.UUID
	host.Scan("20000000-0000-4000-8000-000000000002")
	player.Scan("20000000-0000-4000-8000-000000000001")
	eventID := "30000000-0000-4000-8000-000000000005"
	// Seed times are fresh in this isolated schema.
	makeHandler := func(viewer pgtype.UUID) Handler {
		return Handler{Queries: database.New(pool), Pool: pool, DemoUserID: viewer}
	}
	call := func(viewer pgtype.UUID, method, path, body string, status int) *httptest.ResponseRecorder {
		t.Helper()
		handler := makeHandler(viewer)
		mux := http.NewServeMux()
		mux.HandleFunc("POST /events", handler.CreateEvent)
		mux.HandleFunc("PATCH /events/{id}", handler.UpdateEvent)
		mux.HandleFunc("GET /events/{id}", handler.GetEvent)
		mux.HandleFunc("PUT /events/{id}/participation", handler.ChangeParticipation)
		mux.HandleFunc("DELETE /events/{id}/participation", handler.ChangeParticipation)
		mux.HandleFunc("GET /events/{id}/messages", handler.Messages)
		mux.HandleFunc("POST /events/{id}/messages", handler.Messages)
		mux.HandleFunc("PUT /events/{id}/cancellation", handler.CancelEvent)
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest(method, path, strings.NewReader(body)))
		if response.Code != status {
			t.Fatalf("%s %s: %d want %d: %s", method, path, response.Code, status, response.Body.String())
		}
		return response
	}
	snapshotObserved := make(chan struct{}, 1)
	start := func(viewer pgtype.UUID) (*httptest.Server, *websocket.Conn) {
		t.Helper()
		handler := makeHandler(viewer)
		live := realtime.NewServer(pool)
		live.Authorize = handler.RealtimeAccess
		live.RelatedTargets = handler.RealtimeRelatedTargets
		live.Snapshot = func(ctx context.Context, target realtime.Target, viewer pgtype.UUID, after int64) (realtime.Frame, error) {
			frame, err := handler.RealtimeSnapshot(ctx, target, viewer, after)
			if target.Type == database.RealtimeTargetTypeEventMessages && after == 2 {
				select {
				case snapshotObserved <- struct{}{}:
				default:
				}
			}
			return frame, err
		}
		live.Viewer = func(context.Context) (pgtype.UUID, error) { return viewer, nil }
		serviceCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		go func() { defer close(done); live.Run(serviceCtx) }()
		mux := http.NewServeMux()
		mux.HandleFunc("GET /ws", live.WebSocket)
		mux.HandleFunc("GET /realtime", live.LongPoll)
		server := httptest.NewServer(mux)
		t.Cleanup(func() { cancel(); <-done; server.Close() })
		var connection *websocket.Conn
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			var response *http.Response
			connection, response, err = websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(server.URL, "http")+"/ws", nil)
			if response != nil {
				response.Body.Close()
			}
			if err == nil {
				t.Cleanup(func() { connection.Close() })
				return server, connection
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatal("socket not ready:", err)
		return nil, nil
	}
	hostServer, hostSocket := start(host)
	_, playerSocket := start(player) // Independent API instance, same durable outbox.
	read := func(connection *websocket.Conn, kind string) realtime.Frame {
		t.Helper()
		connection.SetReadDeadline(time.Now().Add(5 * time.Second))
		for {
			var frame realtime.Frame
			if err := connection.ReadJSON(&frame); err != nil {
				t.Fatal("read frame:", err)
			}
			if frame.Type == kind {
				return frame
			}
		}
	}
	subscribe := func(connection *websocket.Conn, targetType string, kind string) realtime.Frame {
		t.Helper()
		if err := connection.WriteJSON(map[string]string{"type": "subscribe", "request_id": "test", "target_type": targetType, "target_id": eventID}); err != nil {
			t.Fatal(err)
		}
		return read(connection, kind)
	}
	subscribe(hostSocket, "event_details", "subscribed")
	subscribe(playerSocket, "event_details", "subscribed")
	if frame := subscribe(playerSocket, "event_messages", "error"); frame.Code != "forbidden" {
		t.Fatal("nonparticipant chat accepted", frame)
	}

	// A failed outbox write must roll back the business change and sequence together.
	if _, err = pool.Exec(ctx, `CREATE FUNCTION reject_realtime() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected outbox failure'; END; $$; CREATE TRIGGER reject_realtime BEFORE INSERT ON realtime_outbox FOR EACH ROW EXECUTE FUNCTION reject_realtime()`); err != nil {
		t.Fatal(err)
	}
	call(player, "PUT", "/events/"+eventID+"/participation", "", 500)
	var members, streams int
	if err = pool.QueryRow(ctx, `SELECT (SELECT count(*) FROM event_participants WHERE event_id=$1),(SELECT count(*) FROM realtime_streams WHERE target_id=$1)`, eventID).Scan(&members, &streams); err != nil || members != 1 || streams != 0 {
		t.Fatalf("partial transaction: %d members %d streams: %v", members, streams, err)
	}
	if _, err = pool.Exec(ctx, `DROP TRIGGER reject_realtime ON realtime_outbox; DROP FUNCTION reject_realtime()`); err != nil {
		t.Fatal(err)
	}

	call(player, "PUT", "/events/"+eventID+"/participation", "", 204)
	for _, connection := range []*websocket.Conn{hostSocket, playerSocket} {
		frame := read(connection, "update")
		var snapshot struct {
			ParticipantCount int             `json:"participant_count"`
			Viewer           json.RawMessage `json:"viewer"`
		}
		json.Unmarshal(frame.Payload, &snapshot)
		if frame.Sequence != "1" || snapshot.ParticipantCount != 2 || snapshot.Viewer != nil {
			t.Fatalf("wrong/shared viewer snapshot: %+v %s", frame, frame.Payload)
		}
	}
	call(player, "PUT", "/events/"+eventID+"/participation", "", 204)
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM realtime_outbox WHERE target_id=$1`, eventID).Scan(&members); err != nil || members != 1 {
		t.Fatal("idempotent join created update", members, err)
	}
	subscribe(hostSocket, "event_messages", "subscribed")
	subscribe(playerSocket, "event_messages", "subscribed")
	body := `{"id":"70000000-0000-4000-8000-000000000001","body":"Live hello"}`
	call(host, "POST", "/events/"+eventID+"/messages", body, 204)
	call(host, "POST", "/events/"+eventID+"/messages", body, 204)
	for _, connection := range []*websocket.Conn{hostSocket, playerSocket} {
		frame := read(connection, "update")
		var message chatMessage
		json.Unmarshal(frame.Payload, &message)
		if frame.TargetType != database.RealtimeTargetTypeEventMessages || frame.Sequence != "1" || message.Body != "Live hello" || message.Sequence != "1" {
			t.Fatalf("wrong live message: %+v", frame)
		}
	}
	if err = pool.QueryRow(ctx, `SELECT count(*) FROM realtime_outbox WHERE target_id=$1 AND target_type='event_messages'`, eventID).Scan(&members); err != nil || members != 1 {
		t.Fatal("duplicate message update", members, err)
	}

	// HTTP history recovers messages missed while disconnected.
	playerSocket.Close()
	call(host, "POST", "/events/"+eventID+"/messages", strings.ReplaceAll(body, "000000000001", "000000000002"), 204)
	response := call(player, "GET", "/events/"+eventID+"/messages?after_sequence=1", "", 200)
	var page struct {
		Messages []chatMessage `json:"messages"`
	}
	if err = json.Unmarshal(response.Body.Bytes(), &page); err != nil || len(page.Messages) != 1 || page.Messages[0].Sequence != "2" {
		t.Fatalf("missed-message recovery: %s %v", response.Body.String(), err)
	}
	_, playerSocket = start(player)
	subscribe(playerSocket, "event_messages", "subscribed")
	call(player, "DELETE", "/events/"+eventID+"/participation", "", 204)
	if frame := read(playerSocket, "error"); frame.Code != "forbidden" {
		t.Fatal("open chat not revoked", frame)
	}

	// Long polling waits, then wakes on a committed event change.
	completed := make(chan *http.Response, 1)
	go func() {
		response, _ := http.Get(hostServer.URL + "/realtime?target_type=event_details&target_id=" + eventID + "&after=2")
		completed <- response
	}()
	edit := fmt.Sprintf(`{"title":"Live edited","starts_at":%q,"capacity":8}`, time.Now().Add(3*time.Hour).UTC().Format(time.RFC3339))
	call(host, "PATCH", "/events/"+eventID, edit, 204)
	select {
	case response := <-completed:
		if response == nil {
			t.Fatal("long poll failed")
		}
		defer response.Body.Close()
		var frame realtime.Frame
		if err = json.NewDecoder(response.Body).Decode(&frame); err != nil || response.StatusCode != 200 || frame.Sequence != "3" {
			t.Fatalf("long poll: %d %+v %v", response.StatusCode, frame, err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("long poll did not wake")
	}
	// Cancelled chat metadata wakes even though the message sequence is unchanged.
	chatPoll := make(chan *http.Response, 1)
	go func() {
		response, _ := http.Get(hostServer.URL + "/realtime?target_type=event_messages&target_id=" + eventID + "&after=2")
		chatPoll <- response
	}()
	select {
	case <-snapshotObserved:
	case <-time.After(5 * time.Second):
		t.Fatal("chat poll did not start")
	}
	call(host, "PUT", "/events/"+eventID+"/cancellation", "", 204)
	select {
	case response := <-chatPoll:
		if response == nil {
			t.Fatal("chat long poll failed")
		}
		var frame realtime.Frame
		decodeErr := json.NewDecoder(response.Body).Decode(&frame)
		response.Body.Close()
		if decodeErr != nil || !strings.Contains(string(frame.Payload), `"can_send":false`) {
			t.Fatalf("chat status did not wake fallback: %s %v", frame.Payload, decodeErr)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("chat fallback did not wake for cancellation")
	}

	response = call(host, "GET", "/events/"+eventID+"/messages?after_sequence=2", "", 200)
	if !strings.Contains(response.Body.String(), `"can_send":false`) {
		t.Fatal("cancelled chat writable", response.Body.String())
	}
}
