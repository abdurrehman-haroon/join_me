export type TargetType = "event_details" | "event_messages";
export type LiveStatus =
  "connecting" | "live" | "reconnecting" | "fallback" | "offline";
export type LiveFrame = {
  type:
    | "subscribed"
    | "update"
    | "snapshot"
    | "resync"
    | "error"
    | "pong"
    | "unsubscribed";
  id?: string;
  request_id?: string;
  target_type?: TargetType;
  target_id?: string;
  sequence?: string;
  payload?: unknown;
  code?: string;
};
export type LiveListener = {
  ready: () => void;
  update: (frame: LiveFrame) => void;
  error: (code: string) => void;
};
type Subscription = {
  type: TargetType;
  id: string;
  listeners: Set<LiveListener>;
  cursor?: string;
  denied: boolean;
  pollReady?: boolean;
  poll?: AbortController;
  timer?: ReturnType<typeof setTimeout>;
};

export function compareSequence(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  return left === right ? 0 : left < right ? -1 : 1;
}
export function validSequence(value: unknown): value is string {
  return typeof value === "string" && /^(0|[1-9][0-9]{0,18})$/.test(value);
}

// Transport and subscriptions are shared; each feature owns its payload and recovery.
export class RealtimeClient {
  private subscriptions = new Map<string, Subscription>();
  private statusListeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private active = false;
  private failures = 0;
  private generation = 0;
  private requestID = 0;
  private status: LiveStatus = "offline";
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private handshakeTimer?: ReturnType<typeof setTimeout>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private lastPong = 0;

  constructor(private apiURL: string) {}

  getStatus = () => this.status;
  watchStatus = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };
  private setStatus(status: LiveStatus) {
    if (status === this.status) return;
    this.status = status;
    this.statusListeners.forEach((listener) => listener());
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      this.stopConnection();
      this.setStatus("offline");
    } else {
      this.failures = 0;
      this.connect();
    }
  }

  subscribe(type: TargetType, id: string, listener: LiveListener) {
    const key = `${type}:${id}`;
    let entry = this.subscriptions.get(key);
    if (!entry) {
      entry = { type, id, listeners: new Set(), denied: false };
      this.subscriptions.set(key, entry);
    }
    entry.listeners.add(listener);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.send({ type: "subscribe", target_type: type, target_id: id });
    } else if (this.status === "fallback") {
      this.startPoll(entry);
    } else {
      this.connect();
    }
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size) return;
      this.stopPoll(entry);
      this.subscriptions.delete(key);
      this.send({ type: "unsubscribe", target_type: type, target_id: id });
      if (!this.subscriptions.size) {
        this.stopConnection();
        this.setStatus("offline");
      }
    };
  }

  remember(type: TargetType, id: string, sequence: string) {
    const entry = this.subscriptions.get(`${type}:${id}`);
    if (
      entry &&
      validSequence(sequence) &&
      (!entry.cursor || compareSequence(sequence, entry.cursor) > 0)
    )
      entry.cursor = sequence;
  }

  private send(command: Record<string, string>) {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    if ((this.socket.bufferedAmount ?? 0) > 65536) {
      this.socket.close();
      return;
    }
    try {
      this.socket.send(
        JSON.stringify({ ...command, request_id: String(++this.requestID) }),
      );
    } catch {
      this.socket.close();
    }
  }

  private connect() {
    if (
      !this.active ||
      !this.subscriptions.size ||
      this.socket ||
      this.reconnectTimer
    )
      return;
    const generation = ++this.generation;
    if (this.status !== "fallback")
      this.setStatus(this.failures ? "reconnecting" : "connecting");
    let socket: WebSocket;
    try {
      socket = new WebSocket(`${this.apiURL.replace(/^http/, "ws")}/ws`);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    const current = () =>
      this.generation === generation && this.socket === socket;
    this.handshakeTimer = setTimeout(() => {
      if (current()) {
        socket.close();
        this.connectionLost(socket);
      }
    }, 10000);
    socket.onopen = () => {
      if (!current()) return;
      clearTimeout(this.handshakeTimer);
      this.failures = 0;
      this.lastPong = Date.now();
      for (const entry of this.subscriptions.values()) {
        this.stopPoll(entry);
        if (!entry.denied)
          this.send({
            type: "subscribe",
            target_type: entry.type,
            target_id: entry.id,
          });
      }
      this.setStatus("live");
      this.heartbeat = setInterval(() => {
        if (!current()) return;
        if (Date.now() - this.lastPong > 45000) {
          socket.close();
          this.connectionLost(socket);
          return;
        }
        this.send({ type: "ping" });
      }, 15000);
    };
    socket.onmessage = (message) => {
      if (!current()) return;
      try {
        if (typeof message.data !== "string" || message.data.length > 65536)
          throw new Error("invalid frame size");
        const frame: LiveFrame = JSON.parse(message.data);
        if (frame.type === "pong") {
          this.lastPong = Date.now();
          return;
        }
        const entry = this.subscriptions.get(
          `${frame.target_type}:${frame.target_id}`,
        );
        if (!entry) return;
        if (frame.type === "subscribed") {
          entry.listeners.forEach((listener) => listener.ready());
          return;
        }
        if (frame.type === "error") {
          if (frame.code === "forbidden" || frame.code === "not_found")
            entry.denied = true;
          entry.listeners.forEach((listener) =>
            listener.error(frame.code ?? "unavailable"),
          );
          if (!entry.denied) {
            socket.close();
            this.connectionLost(socket);
          }
          return;
        }
        if (
          frame.type === "resync" ||
          (frame.type === "update" && validSequence(frame.sequence))
        ) {
          entry.listeners.forEach((listener) => listener.update(frame));
        }
      } catch (error) {
        console.warn(
          "Realtime protocol error",
          error instanceof Error ? error.message : "invalid frame",
        );
        socket.close();
        this.connectionLost(socket);
      }
    };
    socket.onerror = () => {
      if (!current()) return;
      console.warn("Realtime connection failed; recovering subscriptions");
      socket.close();
      this.connectionLost(socket);
    };
    socket.onclose = () => {
      if (current()) this.connectionLost(socket);
    };
  }

  private connectionLost(socket: WebSocket) {
    if (this.socket !== socket) return;
    this.socket = null;
    clearTimeout(this.handshakeTimer);
    clearInterval(this.heartbeat);
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (!this.active || !this.subscriptions.size || this.reconnectTimer) return;
    this.failures++;
    if (this.failures >= 3 || this.status === "fallback") {
      this.setStatus("fallback");
      for (const entry of this.subscriptions.values()) this.startPoll(entry);
    } else this.setStatus("reconnecting");
    const delay =
      this.status === "fallback"
        ? 60000
        : Math.min(30000, 500 * 2 ** Math.min(this.failures, 6)) *
          (0.75 + Math.random() * 0.5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }

  private stopPoll(entry: Subscription) {
    entry.pollReady = false;
    entry.poll?.abort();
    entry.poll = undefined;
    clearTimeout(entry.timer);
    entry.timer = undefined;
  }

  private startPoll(entry: Subscription) {
    if (
      !this.active ||
      entry.denied ||
      entry.poll ||
      entry.timer ||
      this.status !== "fallback"
    )
      return;
    const controller = new AbortController();
    entry.poll = controller;
    const timeout = setTimeout(() => controller.abort(), 27000);
    let failed = false;
    const run = async () => {
      try {
        const params = `target_type=${entry.type}&target_id=${encodeURIComponent(entry.id)}${entry.cursor ? `&after=${entry.cursor}` : ""}`;
        const response = await fetch(`${this.apiURL}/realtime?${params}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 403 || response.status === 404) {
          entry.denied = true;
          entry.listeners.forEach((listener) =>
            listener.error(response.status === 403 ? "forbidden" : "not_found"),
          );
          return;
        }
        if (response.status !== 204 && !response.ok)
          throw new Error(`HTTP ${response.status}`);
        if (response.status !== 204) {
          const frame: LiveFrame = await response.json();
          if (controller.signal.aborted) return;
          if (
            !validSequence(frame.sequence) ||
            frame.target_type !== entry.type ||
            frame.target_id !== entry.id
          )
            throw new Error("invalid fallback frame");
          entry.listeners.forEach((listener) => listener.update(frame));
          if (
            !entry.cursor ||
            compareSequence(frame.sequence, entry.cursor) > 0
          )
            entry.cursor = frame.sequence;
        }
      } catch {
        failed = true;
        if (!controller.signal.aborted)
          entry.listeners.forEach((listener) => listener.error("unavailable"));
      } finally {
        clearTimeout(timeout);
        if (entry.poll !== controller) return;
        entry.poll = undefined;
        if (
          this.subscriptions.get(`${entry.type}:${entry.id}`) === entry &&
          this.active &&
          !entry.denied &&
          this.status === "fallback"
        ) {
          entry.timer = setTimeout(
            () => {
              entry.timer = undefined;
              this.startPoll(entry);
            },
            failed ? 2000 + Math.random() * 1000 : 0,
          );
        }
      }
    };
    if (!entry.pollReady) {
      entry.pollReady = true;
      entry.listeners.forEach((listener) => listener.ready());
    }
    void run();
  }

  private stopConnection() {
    ++this.generation;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    clearTimeout(this.handshakeTimer);
    clearInterval(this.heartbeat);
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    for (const entry of this.subscriptions.values()) this.stopPoll(entry);
  }
}
