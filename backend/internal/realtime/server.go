package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"joinme/backend/internal/database"
)

const maxFrameBytes = 64 * 1024

type Server struct {
	Pool           *pgxpool.Pool
	Viewer         func(context.Context) (pgtype.UUID, error)
	Authorize      func(context.Context, Target, pgtype.UUID) error
	Snapshot       func(context.Context, Target, pgtype.UUID, int64) (Frame, error)
	RelatedTargets func(Target) []Target
	ready          atomic.Bool
	wake           chan struct{}
	mu             sync.Mutex
	listeners      map[Target]map[*listener]struct{}
	connections    map[*socket]struct{}
	nextConnection atomic.Uint64
}

type listener struct{ notify func(Frame) }

type socket struct {
	server        *Server
	connection    *websocket.Conn
	viewer        pgtype.UUID
	id            uint64
	out           chan Frame
	done          chan struct{}
	closeOnce     sync.Once
	mu            sync.Mutex
	subscriptions map[Target]func()
}

func NewServer(pool *pgxpool.Pool) *Server {
	return &Server{Pool: pool, wake: make(chan struct{}, 1), listeners: make(map[Target]map[*listener]struct{}), connections: make(map[*socket]struct{})}
}

func (server *Server) listen(target Target, notify func(Frame)) func() {
	subscription := &listener{notify: notify}
	server.mu.Lock()
	if server.listeners[target] == nil {
		server.listeners[target] = make(map[*listener]struct{})
	}
	server.listeners[target][subscription] = struct{}{}
	server.mu.Unlock()
	return func() {
		server.mu.Lock()
		delete(server.listeners[target], subscription)
		if len(server.listeners[target]) == 0 {
			delete(server.listeners, target)
		}
		server.mu.Unlock()
	}
}

func (server *Server) deliver(target Target, frame Frame) {
	server.mu.Lock()
	listeners := make([]*listener, 0, len(server.listeners[target]))
	for subscription := range server.listeners[target] {
		listeners = append(listeners, subscription)
	}
	server.mu.Unlock()
	for _, subscription := range listeners {
		subscription.notify(frame)
	}
}

// A lost database subscription may hide a publication. Force snapshot/history recovery.
func (server *Server) disconnect() {
	server.ready.Store(false)
	server.mu.Lock()
	connections := make([]*socket, 0, len(server.connections))
	targets := make([]Target, 0, len(server.listeners))
	for connection := range server.connections {
		connections = append(connections, connection)
	}
	for target := range server.listeners {
		targets = append(targets, target)
	}
	server.mu.Unlock()
	for _, connection := range connections {
		connection.close()
	}
	for _, target := range targets {
		server.deliver(target, Frame{Type: "resync"})
	}
}

func targetFrom(rawType string, rawID string) (Target, error) {
	target := Target{Type: database.RealtimeTargetType(rawType)}
	if rawType == "" || len(rawType) > 64 {
		return target, ErrInvalidTarget
	}
	if err := target.ID.Scan(rawID); err != nil || !target.ID.Valid {
		return target, ErrInvalidTarget
	}
	return target, nil
}

func errorCode(err error) string {
	switch {
	case errors.Is(err, ErrForbidden):
		return "forbidden"
	case errors.Is(err, ErrNotFound):
		return "not_found"
	case errors.Is(err, ErrInvalidTarget):
		return "invalid_target"
	default:
		return "unavailable"
	}
}

func (server *Server) WebSocket(w http.ResponseWriter, request *http.Request) {
	if !server.ready.Load() {
		http.Error(w, "realtime unavailable", 503)
		return
	}
	viewer, err := server.Viewer(request.Context())
	if err != nil {
		http.Error(w, "identity unavailable", 503)
		return
	}
	server.mu.Lock()
	full := len(server.connections) >= 1024
	server.mu.Unlock()
	if full {
		http.Error(w, "too many realtime connections", 503)
		return
	}
	// The default same-origin check rejects untrusted browser origins; native apps omit Origin.
	upgrader := websocket.Upgrader{HandshakeTimeout: 5 * time.Second, ReadBufferSize: 4096, WriteBufferSize: 4096}
	connection, err := upgrader.Upgrade(w, request, nil)
	if err != nil {
		return
	}
	client := &socket{server: server, connection: connection, viewer: viewer, id: server.nextConnection.Add(1), out: make(chan Frame, 64), done: make(chan struct{}), subscriptions: make(map[Target]func())}
	server.mu.Lock()
	server.connections[client] = struct{}{}
	server.mu.Unlock()
	defer client.close()
	if !server.ready.Load() {
		return
	}
	log.Printf("realtime connection=%d opened", client.id)
	go client.writeLoop(request.Context())
	connection.SetReadLimit(4096)
	connection.SetReadDeadline(time.Now().Add(60 * time.Second))
	connection.SetPongHandler(func(string) error { return connection.SetReadDeadline(time.Now().Add(60 * time.Second)) })
	window, commands := time.Now(), 0
	for {
		messageType, raw, readErr := connection.ReadMessage()
		if readErr != nil {
			if !websocket.IsCloseError(readErr, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("realtime connection=%d read closed: %v", client.id, readErr)
			}
			return
		}
		if time.Since(window) >= time.Second {
			window, commands = time.Now(), 0
		}
		commands++
		if messageType != websocket.TextMessage || commands > 40 {
			return
		}
		var command struct {
			Type       string `json:"type"`
			RequestID  string `json:"request_id"`
			TargetType string `json:"target_type"`
			TargetID   string `json:"target_id"`
		}
		decoder := json.NewDecoder(strings.NewReader(string(raw)))
		decoder.DisallowUnknownFields()
		if err = decoder.Decode(&command); err != nil || decoder.Decode(new(any)) != io.EOF || len(command.RequestID) > 100 {
			client.enqueue(Frame{Type: "error", Code: "invalid_command"})
			continue
		}
		if command.Type == "ping" {
			client.enqueue(Frame{Type: "pong", RequestID: command.RequestID})
			continue
		}
		target, parseErr := targetFrom(command.TargetType, command.TargetID)
		if parseErr != nil {
			client.enqueue(Frame{Type: "error", RequestID: command.RequestID, Code: "invalid_target"})
			continue
		}
		if command.Type == "unsubscribe" {
			client.remove(target)
			client.enqueue(Frame{Type: "unsubscribed", RequestID: command.RequestID, TargetType: target.Type, TargetID: target.ID})
			continue
		}
		if command.Type != "subscribe" {
			client.enqueue(Frame{Type: "error", RequestID: command.RequestID, Code: "invalid_command"})
			continue
		}
		ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
		accessErr := server.Authorize(ctx, target, viewer)
		cancel()
		if accessErr != nil {
			client.enqueue(Frame{Type: "error", RequestID: command.RequestID, TargetType: target.Type, TargetID: target.ID, Code: errorCode(accessErr)})
			continue
		}
		client.mu.Lock()
		if _, exists := client.subscriptions[target]; !exists {
			if len(client.subscriptions) >= 32 {
				client.mu.Unlock()
				client.enqueue(Frame{Type: "error", RequestID: command.RequestID, Code: "subscription_limit"})
				continue
			}
			client.subscriptions[target] = server.listen(target, client.enqueue)
		}
		client.mu.Unlock()
		client.enqueue(Frame{Type: "subscribed", RequestID: command.RequestID, TargetType: target.Type, TargetID: target.ID})
	}
}

func (client *socket) remove(target Target) {
	client.mu.Lock()
	if stop, exists := client.subscriptions[target]; exists {
		stop()
		delete(client.subscriptions, target)
	}
	client.mu.Unlock()
}

func (client *socket) enqueue(frame Frame) {
	select {
	case <-client.done:
		return
	default:
	}
	select {
	case client.out <- frame:
	default:
		log.Printf("realtime connection=%d closed: send queue full", client.id)
		client.close()
	}
}

func (client *socket) close() {
	client.closeOnce.Do(func() {
		close(client.done)
		client.connection.Close()
		client.mu.Lock()
		for _, stop := range client.subscriptions {
			stop()
		}
		clear(client.subscriptions)
		client.mu.Unlock()
		client.server.mu.Lock()
		delete(client.server.connections, client)
		client.server.mu.Unlock()
	})
}

// Only this goroutine writes data frames. Slow writes cannot block other clients.
func (client *socket) writeLoop(ctx context.Context) {
	defer client.close()
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-client.done:
			return
		case <-ticker.C:
			if err := client.connection.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second)); err != nil {
				return
			}
		case frame := <-client.out:
			target := Target{Type: frame.TargetType, ID: frame.TargetID}
			if frame.Type == "update" || frame.Type == "resync" {
				client.mu.Lock()
				_, subscribed := client.subscriptions[target]
				client.mu.Unlock()
				if !subscribed {
					continue
				}
				accessCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
				err := client.server.Authorize(accessCtx, target, client.viewer)
				cancel()
				if err != nil {
					client.remove(target)
					frame = Frame{Type: "error", TargetType: target.Type, TargetID: target.ID, Code: errorCode(err)}
				}
			}
			raw, err := json.Marshal(frame)
			if err != nil {
				log.Printf("realtime connection=%d encode failed: %v", client.id, err)
				return
			}
			if len(raw) > maxFrameBytes {
				// Large rosters use HTTP; keep the live transport bounded.
				raw, _ = json.Marshal(Frame{Type: "resync", TargetType: target.Type, TargetID: target.ID})
			}
			client.connection.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err = client.connection.WriteMessage(websocket.TextMessage, raw); err != nil {
				log.Printf("realtime connection=%d write failed: %v", client.id, err)
				return
			}
		}
	}
}

func (server *Server) LongPoll(w http.ResponseWriter, request *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	if !server.ready.Load() {
		http.Error(w, "realtime unavailable", 503)
		return
	}
	viewer, err := server.Viewer(request.Context())
	if err != nil {
		http.Error(w, "identity unavailable", 503)
		return
	}
	target, err := targetFrom(request.URL.Query().Get("target_type"), request.URL.Query().Get("target_id"))
	if err != nil {
		http.Error(w, "invalid target", 400)
		return
	}
	after := int64(-1)
	if value := request.URL.Query().Get("after"); value != "" {
		after, err = strconv.ParseInt(value, 10, 64)
		if err != nil || after < 0 {
			http.Error(w, "invalid sequence", 400)
			return
		}
	}
	changed := make(chan struct{}, 1)
	stop := server.listen(target, func(Frame) {
		select {
		case changed <- struct{}{}:
		default:
		}
	})
	defer stop()
	timer := time.NewTimer(20 * time.Second)
	dirty := false
	defer timer.Stop()
	for {
		if !server.ready.Load() {
			http.Error(w, "realtime unavailable", 503)
			return
		}
		ctx, cancel := context.WithTimeout(request.Context(), 3*time.Second)
		snapshot, snapshotErr := server.Snapshot(ctx, target, viewer, max(after, 0))
		cancel()
		if snapshotErr != nil {
			code := http.StatusServiceUnavailable
			if errors.Is(snapshotErr, ErrInvalidTarget) {
				code = 400
			}
			if errors.Is(snapshotErr, ErrForbidden) {
				code = 403
			}
			if errors.Is(snapshotErr, ErrNotFound) {
				code = 404
			}
			http.Error(w, errorCode(snapshotErr), code)
			return
		}
		sequence, err := strconv.ParseInt(snapshot.Sequence, 10, 64)
		if err != nil {
			http.Error(w, "invalid stream state", 503)
			return
		}
		if sequence > after || dirty {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(snapshot)
			return
		}
		select {
		case <-changed:
			dirty = true
		case <-timer.C:
			w.WriteHeader(http.StatusNoContent)
			return
		case <-request.Context().Done():
			return
		}
	}
}
