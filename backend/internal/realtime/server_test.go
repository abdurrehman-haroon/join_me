package realtime

import (
	"context"
	"encoding/json"
	"github.com/jackc/pgx/v5/pgtype"
	"joinme/backend/internal/database"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestSlowClientQueueIsBounded(t *testing.T) {
	accepted := make(chan *websocket.Conn, 1)
	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		upgrader := websocket.Upgrader{}
		connection, err := upgrader.Upgrade(w, r, nil)
		if err == nil {
			accepted <- connection
		}
	}))
	defer peer.Close()
	connection, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(peer.URL, "http"), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	serverConnection := <-accepted
	server := NewServer(nil)
	client := &socket{server: server, connection: serverConnection, out: make(chan Frame, 1), done: make(chan struct{}), subscriptions: make(map[Target]func())}
	client.enqueue(Frame{Type: "update"})
	client.enqueue(Frame{Type: "update"})
	select {
	case <-client.done:
	default:
		t.Fatal("slow client remained connected")
	}
	if len(client.out) != 1 {
		t.Fatal("queue grew beyond its bound")
	}
}

func TestSocketProtocolLimitsAndResync(t *testing.T) {
	server := NewServer(nil)
	server.ready.Store(true)
	server.Viewer = func(context.Context) (pgtype.UUID, error) {
		var viewer pgtype.UUID
		viewer.Scan("20000000-0000-4000-8000-000000000001")
		return viewer, nil
	}
	server.Authorize = func(context.Context, Target, pgtype.UUID) error { return nil }
	peer := httptest.NewServer(http.HandlerFunc(server.WebSocket))
	defer peer.Close()
	address := "ws" + strings.TrimPrefix(peer.URL, "http")
	denied, response, err := websocket.DefaultDialer.Dial(address, http.Header{"Origin": []string{"https://untrusted.invalid"}})
	if denied != nil {
		denied.Close()
	}
	if response != nil {
		response.Body.Close()
	}
	if err == nil || response == nil || response.StatusCode != 403 {
		t.Fatal("cross-origin socket accepted")
	}
	connection, _, err := websocket.DefaultDialer.Dial(address, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	connection.SetReadDeadline(time.Now().Add(5 * time.Second))
	read := func(kind string) Frame {
		t.Helper()
		var frame Frame
		if err := connection.ReadJSON(&frame); err != nil {
			t.Fatal(err)
		}
		if frame.Type != kind {
			t.Fatalf("got %+v want %s", frame, kind)
		}
		return frame
	}
	if err = connection.WriteMessage(websocket.TextMessage, []byte(`{"type":"ping","extra":true}`)); err != nil {
		t.Fatal(err)
	}
	if frame := read("error"); frame.Code != "invalid_command" {
		t.Fatal(frame)
	}
	id := "30000000-0000-4000-8000-000000000001"
	if err = connection.WriteJSON(map[string]string{"type": "subscribe", "target_type": "event_details", "target_id": id}); err != nil {
		t.Fatal(err)
	}
	read("subscribed")
	var targetID pgtype.UUID
	targetID.Scan(id)
	target := Target{Type: database.RealtimeTargetTypeEventDetails, ID: targetID}
	server.deliver(target, Frame{Type: "update", TargetType: target.Type, TargetID: target.ID, Sequence: "1", Payload: json.RawMessage(`{"large":"` + strings.Repeat("x", maxFrameBytes) + `"}`)})
	read("resync")
	if err = connection.WriteJSON(map[string]string{"type": "unsubscribe", "target_type": "event_details", "target_id": id}); err != nil {
		t.Fatal(err)
	}
	read("unsubscribed")
	server.deliver(target, Frame{Type: "update", TargetType: target.Type, TargetID: target.ID, Sequence: "2", Payload: json.RawMessage(`{}`)})
	connection.WriteJSON(map[string]string{"type": "ping"})
	read("pong")
	connection.WriteMessage(websocket.TextMessage, []byte(strings.Repeat("x", 5000)))
	if _, _, err = connection.ReadMessage(); err == nil {
		t.Fatal("oversized client frame accepted")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		server.mu.Lock()
		remaining := len(server.connections)
		server.mu.Unlock()
		if remaining == 0 {
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("closed connection leaked")
}
