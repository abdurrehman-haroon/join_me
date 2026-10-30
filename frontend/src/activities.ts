export type ActivitySource =
  | "map"
  | "place_details"
  | "event_details"
  | "event_form"
  | "event_chat"
  | "your_events"
  | "profile";
export type Sport = "football" | "cricket" | "padel";
export type SportFilter = "all" | Sport;
export const sportNames: Record<Sport, string> = {
  football: "Football",
  cricket: "Cricket",
  padel: "Padel",
};
export type ClientAction =
  | "session_started"
  | "chat_opened"
  | "sport_filter_selected"
  | "place_viewed"
  | "empty_results_viewed"
  | "event_creation_started"
  | "event_creation_submitted"
  | "event_viewed"
  | "join_attempted"
  | "interaction_paused"
  | "interaction_resumed"
  | "interaction_closed";
export type Activity = {
  id: string;
  action: ClientAction;
  session_id: string;
  interaction_id: string | null;
  interaction_step: number | null;
  trackable_type: "event" | "place" | null;
  trackable_id: string | null;
  source: ActivitySource | null;
  occurred_at: string;
  details: Record<string, unknown>;
};
export type QueuedActivity = { actorID: string | null; activity: Activity };
export type QueueSnapshot = {
  actorID: string | null;
  entries: QueuedActivity[];
};
export type ActivityStorage = {
  load(): Promise<QueueSnapshot>;
  save(snapshot: QueueSnapshot): Promise<void>;
};
const maxAge = 7 * 24 * 60 * 60 * 1000;

// One serialized writer owns persistence. Network acknowledgements remove only sent IDs.
export class ActivityQueue {
  private entries: QueuedActivity[] = [];
  private actorID: string | null = null;
  private writing: Promise<void>;
  private active = false;
  private sending = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private retryMS = 1000;
  private ready = false;
  private sessionStarted = false;

  constructor(
    private apiURL: string,
    private storage: ActivityStorage,
  ) {
    this.writing = storage
      .load()
      .then((saved) => {
        this.actorID = saved.actorID;
        // Unknown ownership from an earlier process cannot safely be reassigned.
        this.entries = saved.entries
          .filter(
            (entry) =>
              entry.actorID &&
              Date.parse(entry.activity.occurred_at) >= Date.now() - maxAge,
          )
          .slice(-1000);
        this.ready = true;
      })
      .catch(() => {
        this.ready = true;
        console.warn("Activity queue could not be restored.");
      });
  }

  startSession(sessionID: string) {
    if (this.sessionStarted) return;
    this.sessionStarted = true;
    this.record({
      id: sessionID,
      action: "session_started",
      session_id: sessionID,
      interaction_id: null,
      interaction_step: null,
      trackable_type: null,
      trackable_id: null,
      source: null,
      occurred_at: new Date().toISOString(),
      details: {},
    });
  }

  record(activity: Activity) {
    this.writing = this.writing
      .then(async () => {
        this.entries.push({ actorID: this.actorID, activity });
        this.entries = this.entries
          .filter(
            (entry) =>
              Date.parse(entry.activity.occurred_at) >= Date.now() - maxAge,
          )
          .slice(-1000);
        await this.storage.save({
          actorID: this.actorID,
          entries: this.entries,
        });
      })
      .catch(() => console.warn("Activity queue could not be saved."));
    this.schedule(300);
  }

  setActive(active: boolean) {
    this.active = active;
    if (!active) {
      clearTimeout(this.timer);
      this.timer = undefined;
    } else this.schedule(300);
  }

  private schedule(delay: number) {
    if (!this.active || this.timer || this.sending) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, delay);
  }

  async flush() {
    if (!this.active || this.sending) return;
    this.sending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let failed = false;
    try {
      await this.writing;
      if (!this.ready) return;
      // Recheck identity before each batch, including after process/API identity changes.
      const profile = await fetch(`${this.apiURL}/me`, {
        signal: controller.signal,
      });
      if (!profile.ok) throw new Error("identity unavailable");
      const owner: { id: string } = await profile.json();
      if (typeof owner.id !== "string") throw new Error("invalid identity");
      this.writing = this.writing.then(async () => {
        this.actorID = owner.id;
        // Only unresolved rows from this process are eligible for initial attribution.
        this.entries = this.entries.filter(
          (entry) =>
            Date.parse(entry.activity.occurred_at) >= Date.now() - maxAge,
        );
        for (const entry of this.entries)
          if (!entry.actorID) entry.actorID = owner.id;
        await this.storage.save({
          actorID: this.actorID,
          entries: this.entries,
        });
      });
      await this.writing;
      const batch = this.entries
        .filter((entry) => entry.actorID === owner.id)
        .slice(0, 25);
      if (batch.length === 0) return;
      const response = await fetch(`${this.apiURL}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          actor_id: owner.id,
          activities: batch.map((entry) => entry.activity),
        }),
      });
      if (!response.ok) throw new Error("activity delivery failed");
      const reply: { results: { id: string | null; status: string }[] } =
        await response.json();
      if (
        !Array.isArray(reply.results) ||
        reply.results.length !== batch.length
      )
        throw new Error("invalid activity acknowledgement");
      const acknowledged = new Set<string>();
      for (const [index, result] of reply.results.entries()) {
        const sentID = batch[index].activity.id;
        if (
          !["accepted", "rejected", "conflict"].includes(result.status) ||
          (result.id !== sentID &&
            !(result.id === null && result.status === "rejected"))
        )
          throw new Error("invalid activity acknowledgement");
        acknowledged.add(sentID);
        if (result.status !== "accepted")
          console.warn("An activity was permanently rejected.");
      }
      if (acknowledged.size !== batch.length)
        throw new Error("incomplete activity acknowledgement");
      this.writing = this.writing.then(async () => {
        this.entries = this.entries.filter(
          (entry) => !acknowledged.has(entry.activity.id),
        );
        await this.storage.save({
          actorID: this.actorID,
          entries: this.entries,
        });
      });
      await this.writing;
      this.retryMS = 1000;
    } catch {
      failed = true;
      this.retryMS = Math.min(this.retryMS * 2, 60000);
      // Recover the writer chain; preserve unacknowledged rows with their original IDs.
      this.writing = this.writing.catch(() => {});
    } finally {
      clearTimeout(timeout);
      this.sending = false;
      if (
        this.entries.some(
          (entry) => !entry.actorID || entry.actorID === this.actorID,
        ) ||
        failed
      )
        this.schedule(failed ? this.retryMS : 300);
    }
  }
}

export type InteractionTarget = { type: "event" | "place"; id: string };

// Pure timing logic, independent of React and native storage, for deterministic tests.
export class ActivityInteraction {
  readonly id: string;
  private started: number;
  private lastActive: number | null = null;
  private activeMS = 0;
  private step = 0;
  private closed = false;
  private foreground: boolean;
  private visible = true;
  private lifecycleSource: ActivitySource;

  constructor(
    private sessionID: string,
    private target: InteractionTarget,
    private source: ActivitySource,
    startAction:
      | "event_creation_started"
      | "event_viewed"
      | "place_viewed"
      | "chat_opened",
    details: Record<string, unknown>,
    private emit: (activity: Activity) => void,
    private uuid: () => string,
    private clock: () => number = () => performance.now(),
    foreground = true,
  ) {
    this.id = uuid();
    this.lifecycleSource = source;
    if (startAction === "chat_opened") this.lifecycleSource = "event_chat";
    else if (startAction === "event_viewed") this.lifecycleSource = "event_details";
    else if (startAction === "place_viewed") this.lifecycleSource = "place_details";
    this.started = clock();
    this.foreground = foreground;
    if (foreground) this.lastActive = this.started;
    this.record(startAction, details);
  }

  record(
    action: ClientAction,
    details: Record<string, unknown> = {},
    source = this.source,
  ) {
    if (this.closed) return;
    const now = this.step === 0 ? this.started : this.clock();
    const active =
      this.activeMS + (this.lastActive === null ? 0 : now - this.lastActive);
    this.emit({
      id: this.uuid(),
      action,
      session_id: this.sessionID,
      interaction_id: this.id,
      interaction_step: ++this.step,
      trackable_type: this.target.type,
      trackable_id: this.target.id,
      source,
      occurred_at: new Date().toISOString(),
      details: {
        ...details,
        elapsed_ms: Math.max(0, Math.round(now - this.started)),
        active_ms: Math.max(0, Math.round(active)),
      },
    });
  }

  setState(visible: boolean, foreground: boolean) {
    if (this.closed) return;
    const wasActive = this.visible && this.foreground;
    this.visible = visible;
    this.foreground = foreground;
    const isActive = visible && foreground;
    if (wasActive === isActive) return;
    if (!isActive) {
      if (this.lastActive !== null)
        this.activeMS += this.clock() - this.lastActive;
      this.lastActive = null;
      this.record(
        "interaction_paused",
        { reason: foreground ? "screen_hidden" : "app_backgrounded" },
        this.lifecycleSource,
      );
    } else {
      this.lastActive = this.clock();
      this.record("interaction_resumed", {}, this.lifecycleSource);
    }
  }

  close(reason: "dismissed" | "completed") {
    if (this.closed) return;
    this.record("interaction_closed", { reason }, this.lifecycleSource);
    this.closed = true;
  }

  headers(requestID: string) {
    return {
      "X-Activity-ID": requestID,
      "X-Activity-Session": this.sessionID,
      "X-Activity-Interaction": this.id,
    };
  }
}

// One map visit groups discovery actions; query fingerprints never leave memory.
export class DiscoveryTracker {
  readonly id: string;
  private step = 0;
  private sport: SportFilter = "all";
  private lastMapEmpty: string | null = null;
  private lastPlaceEmpty: string | null = null;

  constructor(
    private sessionID: string,
    private emit: (activity: Activity) => void,
    private uuid: () => string,
  ) {
    this.id = uuid();
  }

  selectSport(sport: SportFilter): boolean {
    if (sport === this.sport) return false;
    this.sport = sport;
    this.record("sport_filter_selected", { sport });
    return true;
  }

  resetSport() {
    this.sport = "all";
  }

  observeMapResults(
    viewKey: string,
    sport: SportFilter,
    emptyKind: "no_events" | "no_places" | null,
  ) {
    if (!emptyKind) {
      this.lastMapEmpty = null;
      return;
    }
    const key = `${viewKey}|${sport}|${emptyKind}`;
    if (this.lastMapEmpty === key) return;
    this.lastMapEmpty = key;
    this.record("empty_results_viewed", { sport, empty_kind: emptyKind });
  }

  observePlaceResults(
    visit: ActivityInteraction,
    sport: SportFilter,
    empty: boolean,
  ) {
    if (!empty) {
      this.lastPlaceEmpty = null;
      return;
    }
    const key = `${visit.id}|${sport}`;
    if (this.lastPlaceEmpty === key) return;
    this.lastPlaceEmpty = key;
    visit.record(
      "empty_results_viewed",
      { sport, empty_kind: "no_events" },
      "place_details",
    );
  }

  private record(
    action: "sport_filter_selected" | "empty_results_viewed",
    details: Record<string, unknown>,
  ) {
    this.emit({
      id: this.uuid(),
      action,
      session_id: this.sessionID,
      interaction_id: this.id,
      interaction_step: ++this.step,
      trackable_type: null,
      trackable_id: null,
      source: "map",
      occurred_at: new Date().toISOString(),
      details,
    });
  }
}
